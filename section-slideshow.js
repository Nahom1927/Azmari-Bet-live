(function(){
var CSS=".ss{position:relative;aspect-ratio:16/7;min-height:160px;border-radius:14px;overflow:hidden;background:var(--ss-bg,#1f4a41);margin:0 0 16px}.ss figure{position:absolute;inset:0;margin:0;opacity:0;transition:opacity .6s}.ss figure.on{opacity:1}.ss img{width:100%;height:100%;object-fit:cover;display:block}.ss figcaption{position:absolute;left:0;right:0;bottom:0;padding:24px 14px 10px;color:#fff;font-weight:600;background:linear-gradient(transparent,rgba(0,0,0,.7))}.ss .dots{position:absolute;right:12px;top:10px;display:flex;gap:6px}.ss .dots button{width:10px;height:10px;padding:0;border-radius:50%;border:1.5px solid #fff;background:transparent;cursor:pointer}.ss .dots .on{background:var(--ss-accent,#e0a21b);border-color:var(--ss-accent,#e0a21b)}.ss .nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:18px;cursor:pointer}.ss .p{left:10px}.ss .n{right:10px}@media(prefers-reduced-motion:reduce){.ss figure{transition:none}}";
function style(){if(document.getElementById("ss-css"))return;var s=document.createElement("style");s.id="ss-css";s.textContent=CSS;document.head.appendChild(s)}
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function mount(host,items){
  style();
  var old=host.querySelector(":scope > .ss");if(old){clearInterval(old._t);old.remove()}
  var seen={},list=[];
  items.forEach(function(it){if(it.img&&!seen[it.user]){seen[it.user]=1;list.push(it)}}); // newest-first input: one picture per user
  list.sort(function(){return Math.random()-.5});
  if(!list.length)return null;
  var el=document.createElement("div");el.className="ss";el.setAttribute("aria-label","Pictures from members");
  el.innerHTML=list.map(function(it,i){return '<figure class="'+(i?"":"on")+'"><img src="'+esc(it.img)+'" alt="Picture from '+esc(it.user)+'"><figcaption>'+esc(it.user)+'</figcaption></figure>'}).join("")+
   (list.length>1?'<button class="nav p" aria-label="Previous">‹</button><button class="nav n" aria-label="Next">›</button><div class="dots">'+list.map(function(_,i){return '<button aria-label="Slide '+(i+1)+'" class="'+(i?"":"on")+'"></button>'}).join("")+'</div>':"");
  host.insertBefore(el,host.firstChild);
  var cur=0,figs=el.querySelectorAll("figure"),dots=el.querySelectorAll(".dots button");
  function go(i){cur=(i+list.length)%list.length;figs.forEach(function(f,k){f.classList.toggle("on",k===cur)});dots.forEach(function(d,k){d.classList.toggle("on",k===cur)})}
  function play(){clearInterval(el._t);if(list.length>1)el._t=setInterval(function(){go(cur+1)},3500)}
  if(list.length>1){el.querySelector(".p").onclick=function(){go(cur-1)};el.querySelector(".n").onclick=function(){go(cur+1)};dots.forEach(function(d,k){d.onclick=function(){go(k)}})}
  el.onmouseenter=function(){clearInterval(el._t)};el.onmouseleave=play;play();return el;
}
// Read pictures straight from the posts already shown in a section.
function fromDom(section,o){
  o=o||{};var items=[];
  section.querySelectorAll(o.post||"article, .post, .card, li").forEach(function(p){
    if(p.closest(".ss"))return;
    var img=[].slice.call(p.querySelectorAll("img")).filter(function(i){return !/avatar|profile|logo|icon/i.test(i.className+" "+i.alt)})[0];
    var u=p.querySelector(o.user||".user, .author, .name, [data-user]");
    if(img)items.push({user:u?u.textContent.trim():"Member",img:img.currentSrc||img.src});
  });
  return mount(section,items);
}
window.SectionSlideshow={mount:mount,fromDom:fromDom};
})();
