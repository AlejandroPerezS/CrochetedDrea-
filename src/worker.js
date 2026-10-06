const COOKIE_NAME="cd_admin";
const SESSION_SECONDS=8*60*60;
const IMAGE_ROUTE="/product-images/";
const MAX_IMAGE_BYTES=8*1024*1024;
const encoder=new TextEncoder();

function json(data,init){init=init||{};const h=new Headers(init.headers||{});h.set("Content-Type","application/json; charset=utf-8");h.set("Cache-Control","no-store");h.set("X-Content-Type-Options","nosniff");return new Response(JSON.stringify(data),Object.assign({},init,{headers:h}))}
function method(allowed){return json({error:"Method not allowed."},{status:405,headers:{Allow:allowed.join(", ")}})}
function sameOrigin(r){const o=r.headers.get("Origin");return !o||o===new URL(r.url).origin}
async function body(r){if(!(r.headers.get("content-type")||"").includes("application/json"))throw new Error("Expected JSON request body.");return r.json()}
function clean(v,n){return String(v==null?"":v).trim().slice(0,n||1000)}
function integer(v,f){const n=parseInt(v,10);return Number.isFinite(n)?n:(f||0)}
function bool(v){return v===true||v===1||v==="1"?1:0}
function slugify(v){return clean(v,160).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100)||("product-"+crypto.randomUUID().slice(0,8))}
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")))return false;const d=new Date(v+"T00:00:00Z");return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}
function b64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function unb64(v){const s=v.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(v.length/4)*4,"=");return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function hmac(secret,value){const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)))}
async function secureEqual(a,b){const x=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(String(a)))),y=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(String(b))));let r=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)r|=(x[i]||0)^(y[i]||0);return r===0}
function cookie(r,name){const raw=r.headers.get("Cookie")||"";for(const part of raw.split(";")){const pieces=part.trim().split("=");if(pieces.shift()===name)return pieces.join("=")}return ""}
async function credentials(env,u,p){if(!env.ADMIN_USERNAME||!env.ADMIN_PASSWORD)return false;const r=await Promise.all([secureEqual(u,env.ADMIN_USERNAME),secureEqual(p,env.ADMIN_PASSWORD)]);return r[0]&&r[1]}
async function token(env){if(!env.ADMIN_SESSION_SECRET)throw new Error("ADMIN_SESSION_SECRET is not configured.");const payload={role:"admin",exp:Math.floor(Date.now()/1000)+SESSION_SECONDS,nonce:crypto.randomUUID()},part=b64(encoder.encode(JSON.stringify(payload))),sig=b64(await hmac(env.ADMIN_SESSION_SECRET,part));return part+"."+sig}
async function verify(r,env){if(!env.ADMIN_SESSION_SECRET)return null;const t=cookie(r,COOKIE_NAME),parts=t.split(".");if(parts.length!==2)return null;try{const expected=await hmac(env.ADMIN_SESSION_SECRET,parts[0]),supplied=unb64(parts[1]);if(expected.length!==supplied.length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected[i]^supplied[i];if(mismatch)return null;const p=JSON.parse(new TextDecoder().decode(unb64(parts[0])));if(p.role!=="admin"||!p.exp||p.exp<=Math.floor(Date.now()/1000))return null;return p}catch{return null}}
function setCookie(r,t){return COOKIE_NAME+"="+t+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+SESSION_SECONDS+(new URL(r.url).protocol==="https:"?"; Secure":"")}
function clearCookie(r){return COOKIE_NAME+"=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+(new URL(r.url).protocol==="https:"?"; Secure":"")}
async function requireAdmin(r,env){return await verify(r,env)?null:json({error:"Authentication required."},{status:401})}
function map(row){return{id:row.id,name:row.name,slug:row.slug,category:row.category,description:row.description,priceCents:row.price_cents,price:row.price_cents/100,stockQuantity:row.stock_quantity,imagePath:row.image_path,featured:Boolean(row.is_featured),published:Boolean(row.is_published),sortOrder:row.sort_order,createdAt:row.created_at,updatedAt:row.updated_at}}
const SCHEMA_SQL=`
CREATE TABLE IF NOT EXISTS store_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  image_path TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_products_public
ON store_products (is_published, is_featured DESC, sort_order ASC, id DESC);
CREATE TABLE IF NOT EXISTS availability (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','full','blocked')),
  order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_availability_date ON availability (date);
`;
let schemaReadyPromise=null;
async function ensureSchema(env){
  if(!env.DB)throw new Error("D1 binding DB is not configured.");
  if(!schemaReadyPromise){
    schemaReadyPromise=env.DB.exec(SCHEMA_SQL).catch(function(error){
      schemaReadyPromise=null;
      throw error;
    });
  }
  return schemaReadyPromise;
}
async function uniqueSlug(env,value,id){const base=slugify(value);let s=base,n=2;for(;;){const row=await env.DB.prepare("SELECT id FROM store_products WHERE slug=? AND (? IS NULL OR id!=?) LIMIT 1").bind(s,id==null?null:id,id==null?null:id).first();if(!row)return s;s=base+"-"+n++}}

async function login(r,env){if(r.method!=="POST")return method(["POST"]);if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});try{const d=await body(r);if(!await credentials(env,d.username||"",d.password||""))return json({error:"Invalid username or password."},{status:401});return json({ok:true},{headers:{"Set-Cookie":setCookie(r,await token(env))}})}catch(e){return json({error:e.message||"Login failed."},{status:400})}}
async function logout(r){if(r.method!=="POST")return method(["POST"]);if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});return json({ok:true},{headers:{"Set-Cookie":clearCookie(r)}})}
async function session(r,env){if(r.method!=="GET")return method(["GET"]);return await verify(r,env)?json({authenticated:true}):json({authenticated:false},{status:401})}

async function publicProducts(r,env){if(r.method!=="GET")return method(["GET"]);await ensureSchema(env);const q=await env.DB.prepare("SELECT * FROM store_products WHERE is_published=1 ORDER BY is_featured DESC,sort_order ASC,id DESC").all();return json({products:(q.results||[]).map(map)})}
async function homeFeature(r,env){if(r.method!=="GET")return method(["GET"]);await ensureSchema(env);const row=await env.DB.prepare("SELECT * FROM store_products WHERE is_published=1 AND TRIM(image_path)!='' ORDER BY RANDOM() LIMIT 1").first();return json({product:row?map(row):null})}
async function adminProducts(r,env){const a=await requireAdmin(r,env);if(a)return a;await ensureSchema(env);if(r.method==="GET"){const q=await env.DB.prepare("SELECT * FROM store_products ORDER BY sort_order ASC,id DESC").all();return json({products:(q.results||[]).map(map)})}if(r.method!=="POST")return method(["GET","POST"]);if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});const d=await body(r),name=clean(d.name,160);if(!name)return json({error:"Product name is required."},{status:400});const s=await uniqueSlug(env,d.slug||name,null);const res=await env.DB.prepare("INSERT INTO store_products(name,slug,category,description,price_cents,stock_quantity,image_path,is_featured,is_published,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(name,s,clean(d.category,100),clean(d.description,4000),Math.max(0,integer(d.priceCents)),Math.max(0,integer(d.stockQuantity)),clean(d.imagePath,500),bool(d.featured),d.published===false?0:1,integer(d.sortOrder)).run();const row=await env.DB.prepare("SELECT * FROM store_products WHERE id=?").bind(res.meta.last_row_id).first();return json({product:map(row)},{status:201})}
async function adminProduct(r,env,idv){const a=await requireAdmin(r,env);if(a)return a;const id=integer(idv,-1);if(id<1)return json({error:"Invalid product id."},{status:400});const old=await env.DB.prepare("SELECT * FROM store_products WHERE id=?").bind(id).first();if(!old)return json({error:"Product not found."},{status:404});if(r.method==="PUT"){if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});const d=await body(r),name=clean(d.name==null?old.name:d.name,160),img=clean(d.imagePath==null?old.image_path:d.imagePath,500),s=await uniqueSlug(env,d.slug||old.slug||name,id);await env.DB.prepare("UPDATE store_products SET name=?,slug=?,category=?,description=?,price_cents=?,stock_quantity=?,image_path=?,is_featured=?,is_published=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,s,clean(d.category==null?old.category:d.category,100),clean(d.description==null?old.description:d.description,4000),Math.max(0,integer(d.priceCents,old.price_cents)),Math.max(0,integer(d.stockQuantity,old.stock_quantity)),img,d.featured===undefined?old.is_featured:bool(d.featured),d.published===undefined?old.is_published:bool(d.published),integer(d.sortOrder,old.sort_order),id).run();if(old.image_path&&old.image_path!==img&&old.image_path.startsWith(IMAGE_ROUTE)){const k=decodeURIComponent(old.image_path.slice(IMAGE_ROUTE.length));if(k)await env.PRODUCT_IMAGES.delete(k).catch(()=>{})}const row=await env.DB.prepare("SELECT * FROM store_products WHERE id=?").bind(id).first();return json({product:map(row)})}if(r.method==="DELETE"){if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});await env.DB.prepare("DELETE FROM store_products WHERE id=?").bind(id).run();if(old.image_path&&old.image_path.startsWith(IMAGE_ROUTE)){const k=decodeURIComponent(old.image_path.slice(IMAGE_ROUTE.length));if(k)await env.PRODUCT_IMAGES.delete(k).catch(()=>{})}return json({ok:true})}return method(["PUT","DELETE"])}

async function upload(r,env){const a=await requireAdmin(r,env);if(a)return a;if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});if(r.method==="DELETE"){const u=new URL(r.url),path=clean(u.searchParams.get("path"),500);if(!path.startsWith(IMAGE_ROUTE))return json({error:"Invalid image path."},{status:400});const key=decodeURIComponent(path.slice(IMAGE_ROUTE.length));if(!key||key.includes(".."))return json({error:"Invalid image path."},{status:400});await env.PRODUCT_IMAGES.delete(key);return json({ok:true})}if(r.method!=="POST")return method(["POST","DELETE"]);const type=(r.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();if(type!=="image/webp")return json({error:"Images must be WebP."},{status:415});const bytes=await r.arrayBuffer();if(!bytes.byteLength)return json({error:"Image is empty."},{status:400});if(bytes.byteLength>MAX_IMAGE_BYTES)return json({error:"Image exceeds 8 MB."},{status:413});const key=new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+".webp";await env.PRODUCT_IMAGES.put(key,bytes,{httpMetadata:{contentType:"image/webp",cacheControl:"public, max-age=31536000, immutable"}});return json({path:IMAGE_ROUTE+key},{status:201})}
async function image(r,env,path){if(r.method!=="GET"&&r.method!=="HEAD")return method(["GET","HEAD"]);const key=decodeURIComponent(path.slice(IMAGE_ROUTE.length));if(!key||key.includes(".."))return new Response("Not found",{status:404});const o=await env.PRODUCT_IMAGES.get(key);if(!o)return new Response("Not found",{status:404});const h=new Headers();o.writeHttpMetadata(h);h.set("etag",o.httpEtag);h.set("Cache-Control","public, max-age=31536000, immutable");return new Response(r.method==="HEAD"?null:o.body,{headers:h})}

async function publicAvailability(r,env){if(r.method!=="GET")return method(["GET"]);await ensureSchema(env);const u=new URL(r.url),from=u.searchParams.get("from")||new Date().toISOString().slice(0,10),to=u.searchParams.get("to")||"9999-12-31";if(!validDate(from)||!validDate(to))return json({error:"Invalid date range."},{status:400});const q=await env.DB.prepare("SELECT date,status,order_count,notes FROM availability WHERE date BETWEEN ? AND ? ORDER BY date ASC").bind(from,to).all();return json({availability:q.results||[]})}
async function adminAvailability(r,env){const a=await requireAdmin(r,env);if(a)return a;await ensureSchema(env);if(r.method==="GET")return publicAvailability(r,env);if(r.method!=="PUT")return method(["GET","PUT"]);if(!sameOrigin(r))return json({error:"Invalid request origin."},{status:403});const d=await body(r),date=clean(d.date,10),status=clean(d.status,20).toLowerCase();if(!validDate(date))return json({error:"Valid date required."},{status:400});if(!["available","full","blocked"].includes(status))return json({error:"Invalid status."},{status:400});await env.DB.prepare("INSERT INTO availability(date,status,order_count,notes,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET status=excluded.status,order_count=excluded.order_count,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP").bind(date,status,Math.max(0,integer(d.orderCount)),clean(d.notes,1000)).run();return json({availability:await env.DB.prepare("SELECT * FROM availability WHERE date=?").bind(date).first()})}

async function api(r,env,p){if(p==="/api/health")return json({ok:true,service:"A Crocheted Dream",adminConfigured:Boolean(env.ADMIN_USERNAME&&env.ADMIN_PASSWORD&&env.ADMIN_SESSION_SECRET),databaseConfigured:Boolean(env.DB),imageStorageConfigured:Boolean(env.PRODUCT_IMAGES)});if(p==="/api/products")return publicProducts(r,env);if(p==="/api/home-feature")return homeFeature(r,env);if(p==="/api/availability")return publicAvailability(r,env);if(p==="/api/admin/login")return login(r,env);if(p==="/api/admin/logout")return logout(r);if(p==="/api/admin/session")return session(r,env);if(p==="/api/admin/products")return adminProducts(r,env);if(p==="/api/admin/images")return upload(r,env);if(p==="/api/admin/availability")return adminAvailability(r,env);const m=p.match(/^\/api\/admin\/products\/(\d+)$/);if(m)return adminProduct(r,env,m[1]);return json({error:"API route not found."},{status:404})}
async function asset(r,env,p){const res=await env.ASSETS.fetch(r),h=new Headers(res.headers);h.set("X-Content-Type-Options","nosniff");h.set("Referrer-Policy","strict-origin-when-cross-origin");h.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");h.set("X-Frame-Options","SAMEORIGIN");if(p==="/admin"||p.startsWith("/admin/")){h.set("Cache-Control","no-store");h.set("X-Robots-Tag","noindex, nofollow, noarchive")}return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h})}
export default{async fetch(r,env){const u=new URL(r.url),p=u.pathname.length>1?u.pathname.replace(/\/+$/,""):u.pathname;try{if(p.startsWith("/api/"))return await api(r,env,p);if(p.startsWith(IMAGE_ROUTE))return await image(r,env,p);return asset(r,env,p)}catch(e){console.error(e);return p.startsWith("/api/")?json({error:"Internal server error."},{status:500}):asset(r,env,p)}}};