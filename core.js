/* 紙飛行機ラボ — 計算の中身（折り・重さの分布・空気の力・飛行）
   画面を持たないので、ブラウザでも node でも同じものが動く。
   長さは、折りの計算だけ mm、物理の計算は m・kg・秒。機体の軸は x=前、y=上、z=右。 */
(function(root){
'use strict';
const G=9.80665, CNMAX=1.25, KFR=1, CEDGE=1;   // KFR：摩擦の倍率（1＝ブラジウスどおり）。CEDGE：前縁の厚みの抵抗係数（前面に動圧がそのままかかるとして 1）
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sstep=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

/* ---------- 紙と空気 ---------- */
const MATERIALS=[ // gsm：坪量（1m²あたりの重さ）。th：1枚の厚さ(mm)の目安。E：ヤング率(GPa)。紙は縦目が横目の約2倍かたいので、その幾何平均
  // コピー用紙は、規格表の曲げこわさ（80g/m²で縦110mN・横55mN、ISO 2493）から逆算して 縦3.8・横1.9 → 平均 2.7GPa。新聞紙は機械パルプでやわらかい
  {id:'news',name:'新聞紙',gsm:46,th:.07,E:1.3},{id:'origami',name:'折り紙',gsm:60,th:.07,E:2.7},{id:'copy',name:'コピー用紙',gsm:67,th:.09,E:2.7},
  {id:'fine',name:'厚口のコピー用紙',gsm:80,th:.10,E:2.7},{id:'guinness',name:'記録挑戦用（上限）',gsm:100,th:.13,E:2.7},{id:'draw',name:'画用紙',gsm:160,th:.22,E:2.0}];
const FOLD_MM=3.2;   // 重なった紙の束がこの厚さをこえると、きれいには折れない（目安）
const SIZES=[{id:'a4',name:'A4',W:210,L:297},{id:'a5',name:'A5',W:148,L:210},{id:'b5',name:'B5',W:182,L:257},
  {id:'a3',name:'A3',W:297,L:420},{id:'ori15',name:'折り紙 15cm',W:150,L:150},{id:'letter',name:'レター',W:216,L:279}];
function makePaper(sizeId,matId){ const s=SIZES.find(x=>x.id===sizeId)||SIZES[0], m=MATERIALS.find(x=>x.id===matId)||MATERIALS[2];
  const t=m.th*1e-3, D=m.E*1e9*t*t*t/12;                       // 1枚の曲げこわさ D = E t³/12（N·m。幅1mあたり）
  return {W:s.W,L:s.L,pw:s.W/2,gsm:m.gsm,th:m.th,E:m.E,D,sigma:m.gsm*1e-9,mass:m.gsm*s.W*s.L*1e-9,size:s,mat:m}; }
/* 気温と標高から、空気の密度と粘り気を出す（標準大気の式、乾いた空気） */
function air(tempC,altM){ const T=tempC+273.15, p=101325*Math.pow(1-2.25577e-5*(altM||0),5.25588);
  return {T,p,rho:p/(287.05*T),mu:1.716e-5*Math.pow(T/273.15,1.5)*(273.15+110.4)/(T+110.4)}; }
/* 風：向かい風 head（m/s、正で正面から）、横風 cross（正で左から）、突風の強さ gust（m/s）。地面に近いほど弱い */
/* 乱数（同じ種からは同じ並びが出る） */
function rng(seed){ let a=(seed>>>0)||1; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
/* 外乱：投げるたびのぶれ・空気のゆらぎ・折りのゆがみ。level 0=なし 1=ふつう 2=強い。数字は標準偏差
   ang=投げる角度(度) roll=左右の傾き(度) yaw=向き(度) dv=速さ(割合) warp=左右の翼の反りの差(度) turb=空気のゆらぎ(m/s) */
const DIST=[null,{ang:1.5,roll:3,yaw:2,dv:.04,warp:.4,turb:.15},{ang:4,roll:8,yaw:5,dv:.10,warp:1,turb:.4}];
function disturb(level,seed){ const d=DIST[level|0]; if(!d) return null; const r=rng(seed), g=()=>{ let u=0; for(let i=0;i<4;i++) u+=r(); return (u-2)*Math.sqrt(3); };   // ほぼ正規分布（標準偏差1）
  const k=Math.PI/180; return {level:level|0,seed,dAng:d.ang*g(),roll:d.roll*g()*k,head:d.yaw*g()*k,dv:d.dv*g(),warp:[d.warp*g()*k,d.warp*g()*k],turb:d.turb,tseed:(seed+7919)>>>0}; }
function makeEnv(o){ o=o||{}; const a=air(o.tempC==null?20:o.tempC,o.alt||0), head=o.head||0, cross=o.cross||0, gust=Math.hypot(o.gust||0,o.turb||0);
  if(o.rho!=null){ a.rho=o.rho; if(o.mu!=null) a.mu=o.mu; }      // 月や火星など、地球の大気の式が使えない場所
  const ph=[1.3,4.1,2.2,5.7,0.4,3.3]; if(o.seed!=null){ const r=rng(o.seed); for(let i=0;i<6;i++) ph[i]=r()*2*Math.PI; }   // 種があれば、ゆらぎの出方を毎回変える
  return {rho:a.rho,mu:a.mu,g:o.g==null?G:o.g,air:a,head,cross,gust,warp:o.warp||null,calm:!head&&!cross&&!gust,
    windAt(p,t,out){ const y=Math.max(p[1],.05), k=Math.min(1.25,Math.pow(y/2,.2));
      let gx=0,gy=0,gz=0; if(gust){ const s=p[0]*.35, u=p[2]*.3;
        gx=gust*(.55*Math.sin(1.9*t+s+ph[0])+.45*Math.sin(4.3*t-1.7*s+ph[1]));
        gy=gust*.5*(.6*Math.sin(2.6*t+1.3*s+ph[2])+.4*Math.sin(5.9*t+u+ph[3]))*Math.min(1,y/1.5);
        gz=gust*(.5*Math.sin(1.4*t+u+ph[4])+.5*Math.sin(3.7*t-s+ph[5])); }
      out[0]=-head*k+gx; out[1]=gy; out[2]=cross*k+gz; return out; }}; }

/* ---------- 折り ---------- */
function area(p){ let a=0; for(let i=0;i<p.length;i++){ const q=p[(i+1)%p.length]; a+=p[i][0]*q[1]-q[0]*p[i][1]; } return a/2; }
function centroid(p){ let a=0,cx=0,cy=0; for(let i=0;i<p.length;i++){ const q=p[(i+1)%p.length], w=p[i][0]*q[1]-q[0]*p[i][1]; a+=w; cx+=(p[i][0]+q[0])*w; cy+=(p[i][1]+q[1])*w; }
  return Math.abs(a)<1e-9?null:[cx/(3*a),cy/(3*a),Math.abs(a)/2]; }      // 多角形の図心と面積
function clipHalf(poly,px,py,nx,ny,sign){        // 直線の片側だけを残す
  const out=[], n=poly.length;
  for(let i=0;i<n;i++){ const a=poly[i], b=poly[(i+1)%n];
    const da=sign*((a[0]-px)*nx+(a[1]-py)*ny), db=sign*((b[0]-px)*nx+(b[1]-py)*ny);
    if(da>=0) out.push(a);
    if((da>0&&db<0)||(da<0&&db>0)){ const t=da/(da-db); out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]); } }
  return out;
}
/* 左右対称なので、紙の右半分だけを持つ（u=中心線からの距離、v=先端からの距離）。
   面は、いまの位置 p と、広げた紙の上での位置 o を、頂点ごとに対で持つ。o の3つ目は「中心線に留まっている点」の印
   （もとから中心線の上にある紙と、中心線をこえて反対側の紙とつながっている所）。ここが中心線から離れると、左右が裂ける */
function newPaper(paper){ const w=paper.pw, L=paper.L; return [{p:[[0,0],[w,0],[w,L],[0,L]],o:[[0,0,1],[w,0,0],[w,L,0],[0,L,1]],flip:false,z:0}]; }
function rankZ(faces){ const zs=[...new Set(faces.map(f=>f.z))].sort((a,b)=>a-b); const m=new Map(zs.map((z,i)=>[z,i])); faces.forEach(f=>f.z=m.get(f.z)); return faces; }
/* 面を直線の片側だけ残す。p と o を対のまま切る。pin＝切り口の点に「留まっている」印を付ける（中心線で切るとき） */
function clipFace(f,px,py,nx,ny,sign,pin){
  const P=[], O=[], p=f.p, o=f.o, n=p.length;
  for(let i=0;i<n;i++){ const a=p[i], b=p[(i+1)%n], oa=o[i], ob=o[(i+1)%n];
    const da=sign*((a[0]-px)*nx+(a[1]-py)*ny), db=sign*((b[0]-px)*nx+(b[1]-py)*ny);
    if(da>=0){ P.push(a); O.push(oa); }
    if((da>0&&db<0)||(da<0&&db>0)){ const t=da/(da-db); P.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]); O.push([oa[0]+(ob[0]-oa[0])*t,oa[1]+(ob[1]-oa[1])*t,pin||(oa[2]&&ob[2])?1:0]); } }
  return P.length>=3&&Math.abs(area(P))>.5?{p:P,o:O}:null;
}
/* 点から多角形のふちまでの距離 */
function edgeDist(poly,x,y){ let m=1e9; for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length], ex=b[0]-a[0], ey=b[1]-a[1], l2=ex*ex+ey*ey, t=l2<1e-12?0:clamp(((x-a[0])*ex+(y-a[1])*ey)/l2,0,1); m=Math.min(m,Math.hypot(a[0]+ex*t-x,a[1]+ey*t-y)); } return m; }
/* 2つの多角形が、面積をもって重なっているか */
function overlaps(A,B){ const c=centroid(A); if(!c) return false; let r=B;
  for(let i=0;i<A.length&&r.length>=3;i++){ const a=A[i], b=A[(i+1)%A.length], nx=-(b[1]-a[1]), ny=b[0]-a[0], L=Math.hypot(nx,ny); if(L<1e-9) continue;
    r=clipHalf(r,a[0],a[1],nx/L,ny/L,((c[0]-a[0])*nx+(c[1]-a[1])*ny)>=0?1:-1); }
  return r.length>=3&&Math.abs(area(r))>.5; }
/* 2つの紙片が、広げた紙の上でつながっているか（辺を分け合っているか）。ただし、いま折ろうとしている線の上のつながりは数えない（そこは開くだけ） */
function linked(P,Q,dist){
  for(let i=0;i<P.o.length;i++){ const i2=(i+1)%P.o.length, a=P.o[i], b=P.o[i2], ex=b[0]-a[0], ey=b[1]-a[1], l=Math.hypot(ex,ey); if(l<.3) continue;
    if(Math.abs(dist(P.p[i]))<.05&&Math.abs(dist(P.p[i2]))<.05) continue;
    const tx=ex/l, ty=ey/l;
    for(let j=0;j<Q.o.length;j++){ const c=Q.o[j], e=Q.o[(j+1)%Q.o.length];
      if(Math.abs((c[0]-a[0])*ty-(c[1]-a[1])*tx)>.03||Math.abs((e[0]-a[0])*ty-(e[1]-a[1])*tx)>.03) continue;
      const s0=(c[0]-a[0])*tx+(c[1]-a[1])*ty, s1=(e[0]-a[0])*tx+(e[1]-a[1])*ty;
      if(Math.min(l,Math.max(s0,s1))-Math.max(0,Math.min(s0,s1))>.3) return true; } }
  return false; }
/* A をつまんで B へ持っていく。折り線は A と B の垂直二等分線。under＝山折り（折った紙が裏側へ回る）。
   top でなければ、A の側の紙が、重なりごと全部裏返る。
   top なら、A の所のいちばん上の紙（山折りなら、いちばん裏の紙）だけを折り返す。その紙とつながっていて一緒に動くしかない紙と、その上にのっている紙は、いっしょに動く */
function fold(faces,A,B,under,top){
  const dx=A[0]-B[0], dy=A[1]-B[1], L=Math.hypot(dx,dy); if(L<4) return {err:'short'};
  const nx=dx/L, ny=dy/L, px=(A[0]+B[0])/2, py=(A[1]+B[1])/2, dist=q=>(q[0]-px)*nx+(q[1]-py)*ny;
  let zmax=0; for(const f of faces) zmax=Math.max(zmax,f.z);
  const parts=faces.map(f=>({f,a:clipFace(f,px,py,nx,ny,-1),b:clipFace(f,px,py,nx,ny,1),mv:!top})), cand=parts.filter(t=>t.b);
  if(top){ const upper=(t,m)=>under?t.f.z<m.f.z:t.f.z>m.f.z; let seed=null;
    for(const r of [0,3]){ for(const t of cand) if((r?edgeDist(t.b.p,A[0],A[1])<r:inside(t.b.p,A[0],A[1]))&&(!seed||upper(t,seed))) seed=t; if(seed) break; }   // つまんだ所の、いちばん上の紙
    if(!seed) return {err:'none'};
    seed.mv=true; const q=[seed];
    while(q.length){ const m=q.pop(); for(const t of cand) if(!t.mv&&(linked(m.b,t.b,dist)||(upper(t,m)&&overlaps(m.b.p,t.b.p)))){ t.mv=true; q.push(t); } } }
  const stay=[], move=[]; let ma=0;
  for(const t of parts){ const f=t.f;
    if(!t.b||!t.mv){ stay.push({p:f.p,o:f.o,flip:f.flip,z:f.z}); continue; }                 // 動かない面は、切らずにそのまま残す
    if(t.a) stay.push({p:t.a.p,o:t.a.o,flip:f.flip,z:f.z});
    const b=t.b, r=b.p.map(q=>{ const d=dist(q); return [q[0]-2*d*nx,q[1]-2*d*ny]; });
    let cross=false; for(let i=0;i<r.length;i++){
      if(b.o[i][2]&&Math.abs(r[i][0])>.5) return {err:'tear'};     // 中心線に留まっている紙が中心線から離れる折りは、左右がそこで裂けるので不可
      if(r[i][0]<-0.05) cross=true; }
    ma+=Math.abs(area(b.p));
    const z=under?-1-f.z:2*zmax+1-f.z, m={p:r,o:b.o,flip:!f.flip,z};
    if(!cross) move.push(m);
    else {                                                         // 中心線をこえて重なる折り：こえたぶんは、反対側の紙が同じだけこちらへ来ている（左右対称）
      const pos=clipFace(m,0,0,1,0,1,1), neg=clipFace(m,0,0,1,0,-1,1);
      if(pos) move.push({p:pos.p,o:pos.o,flip:!f.flip,z});
      if(neg) move.push({p:neg.p.map(q=>[-q[0],q[1]]),o:neg.o,flip:!f.flip,z:z+(under?-.5:.5)}); } }
  if(!move.length) return {err:'none'}; if(!stay.length) return {err:'all'};
  return {faces:rankZ(stay.concat(move)),line:{px,py,nx,ny},ma};
}
/* 線 P1→P2 を引いて「上の紙だけ」折るときの、つまむ点。線の sg 側（+1/−1）で線に接している紙のうち、
   引いた線分にかかっている、いちばん上（山折りなら、いちばん裏）の紙の、線ぎわ 2.5mm 内側の点を返す */
function flapSeed(faces,P1,P2,sg,under){
  const dx=P2[0]-P1[0], dy=P2[1]-P1[1], L=Math.hypot(dx,dy); if(L<4) return null; const tx=dx/L, ty=dy/L, nx=-ty*sg, ny=tx*sg; let best=null;
  for(const f of faces){ const b=clipHalf(f.p,P1[0],P1[1],nx,ny,1); if(b.length<3||Math.abs(area(b))<=.5) continue;
    let lo=1e9, hi=-1e9; for(const q of b) if(Math.abs((q[0]-P1[0])*nx+(q[1]-P1[1])*ny)<.05){ const t=(q[0]-P1[0])*tx+(q[1]-P1[1])*ty; lo=Math.min(lo,t); hi=Math.max(hi,t); }
    if(!(hi-lo>1)) continue;
    const a=Math.max(lo,0), c=Math.min(hi,L), on=c-a>1?1:0, k=under?-f.z:f.z;
    if(!best||on>best.on||(on===best.on&&k>best.k)) best={on,k,t:on?(a+c)/2:(lo+hi)/2}; }
  return best?[P1[0]+tx*best.t+nx*2.5,P1[1]+ty*best.t+ny*2.5]:null;
}
/* いちばん重なっている所の枚数（面の図心ごとに、そこにかかっている面を数える） */
function stack(faces){ let n=1; for(const f of faces){ const c=centroid(f.p); if(!c) continue; let k=0; for(const g of faces) if(inside(g.p,c[0],c[1])) k++; if(k>n) n=k; } return n; }
function bounds(faces){ let umax=0,vmin=1e9,vmax=-1e9; for(const f of faces) for(const q of f.p){ umax=Math.max(umax,q[0]); vmin=Math.min(vmin,q[1]); vmax=Math.max(vmax,q[1]); } return {umax,vmin,vmax}; }
function spanAt(poly,axis,c){   // 凸多角形を直線（axis=0: u=c、axis=1: v=c）で切ったときの区間
  let lo=1e9,hi=-1e9; const n=poly.length, o=1-axis;
  for(let i=0;i<n;i++){ const a=poly[i], b=poly[(i+1)%n], da=a[axis]-c, db=b[axis]-c;
    if(da===0){ lo=Math.min(lo,a[o]); hi=Math.max(hi,a[o]); }
    if((da<0&&db>0)||(da>0&&db<0)){ const t=da/(da-db), w=a[o]+(b[o]-a[o])*t; lo=Math.min(lo,w); hi=Math.max(hi,w); } }
  return hi>lo?[lo,hi]:null;
}
function inside(poly,x,y){ let s=0; for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length], c=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]); if(c!==0){ if(s===0) s=Math.sign(c); else if(Math.sign(c)!==s) return false; } } return true; }

/* ---------- 重さの点から、重心と慣性を出す ---------- */
function massProps(pts){ let m=0,cx=0,cy=0; for(const p of pts){ m+=p[3]; cx+=p[0]*p[3]; cy+=p[1]*p[3]; } cx/=m; cy/=m;
  let Ixx=0,Iyy=0,Izz=0,Ixy=0; for(const p of pts){ const x=p[0]-cx,y=p[1]-cy,z=p[2]; Ixx+=p[3]*(y*y+z*z); Iyy+=p[3]*(x*x+z*z); Izz+=p[3]*(x*x+y*y); Ixy-=p[3]*x*y; }
  return {m,cx,cy,I:[Ixx,Iyy,Izz,Ixy]}; }
/* 空気の見かけの慣性：板が自分に垂直に動くと、まわりの空気（弦を直径とする円柱ぶん）も一緒に動く。軽い紙では無視できない */
function finishInertia(I,el,rho){ let [Ixx,Iyy,Izz,Ixy]=I;
  for(const e of el){ if(e.k===0){ const ma=rho*Math.PI*e.c*e.c/4*e.w, xm=e.le[0]-e.c/2, ny=Math.abs(e.n[1]), nz=Math.abs(e.n[2]);
      Izz+=ma*ny*(xm*xm+e.c*e.c/32); Iyy+=ma*nz*(xm*xm+e.c*e.c/32); Ixx+=ma*(ny*e.le[2]*e.le[2]+nz*e.le[1]*e.le[1])*(e.ring?0:1); }
    else { const d=e.A/e.w, ma=rho*Math.PI*d*d/4*e.w; Iyy+=ma*e.le[0]*e.le[0]; Ixx+=ma*e.le[1]*e.le[1]; } }
  const det=Ixx*Iyy-Ixy*Ixy; return {I:[Ixx,Iyy,Izz,Ixy],Iinv:[Iyy/det,-Ixy/det,Ixx/det,1/Izz]}; }

/* ---------- 折った紙を立体にして、重さと空力の部品に分ける ---------- */
/* prm: h=胴体の深さ(mm) dih=上反角(rad) elev=後ろの縁の反り上げ(rad) e=反り上げる幅(mm) clips=クリップの数 clipV=付ける位置(mm)
   wl=翼の先を立てる幅（翼を12本の帯に分けたうちの、先から何本ぶんか） wa=立てる角度(rad。正で上へ、負で下へ) */
function mapper(prm,vH){
  const cG=Math.cos(prm.dih), sG=Math.sin(prm.dih), cd=Math.cos(prm.elev), sd=Math.sin(prm.elev), h=prm.h;
  const uT=prm.uT==null?1e9:prm.uT, cW=Math.cos(prm.dih+(prm.wa||0)), sW=Math.sin(prm.dih+(prm.wa||0));      // uT より外は、翼の先を立てた部分
  return function(u,v,side,bend){          // side: +1 右、-1 左。戻り値は m
    let x,y,z;
    if(u<=h){ x=-v; y=-(h-u); z=0; }
    else { const s=u-h; let xv=v, yl=0; if(bend!==false&&v>vH){ const d=v-vH; xv=vH+d*cd; yl=d*sd; } x=-xv; if(u>uT){ const s0=uT-h, d=u-uT; y=s0*sG+d*sW+yl; z=s0*cG+d*cW; } else { y=s*sG+yl; z=s*cG; } }
    return [x*1e-3,y*1e-3,z*side*1e-3];
  };
}
function buildPlane(faces,prm,paper,rho){
  const bd=bounds(faces), h=clamp(prm.h,3,Math.max(3,bd.umax-8)), vH=bd.vmax-prm.e;
  const NW=12, dU=(bd.umax-h)/NW, nw=clamp(Math.round(prm.wl||0),0,5), wa=nw?(prm.wa||0):0, uT=nw?bd.umax-nw*dU:null;   // 翼の先を立てる幅は、帯の本数で決める
  const P=mapper(Object.assign({},prm,{h,uT,wa}),vH);
  const pts=[], g=Math.max(4,Math.round(paper.pw/18)); let msum=0;          // 重さの点。升目ごとに、紙がかかっている部分の面積と図心を正確に取る
  for(const f of faces){ let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for(const q of f.p){ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]); y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
    for(let v0=Math.floor(y0/g)*g;v0<y1;v0+=g){ const band=clipHalf(clipHalf(f.p,0,v0,0,1,1),0,v0+g,0,1,-1); if(band.length<3) continue;
      for(let u0=Math.floor(x0/g)*g;u0<x1;u0+=g){ const cell=clipHalf(clipHalf(band,u0,0,1,0,1),u0+g,0,1,0,-1); if(cell.length<3) continue;
        const c=centroid(cell); if(!c||c[2]<1e-7) continue; for(const sd of [1,-1]){ const q=P(c[0],c[1],sd); pts.push([q[0],q[1],q[2],c[2]]); } msum+=2*c[2]; } } }
  for(const q of pts) q[3]*=paper.mass/msum;
  for(let i=0;i<(prm.clips||0);i++) pts.push([-(bd.vmin+(prm.clipV||25)+i*6)*1e-3,-h*1e-3,0,0.0005]);   // 小さいクリップ 約0.5g。折ったあとの機首から測った位置に付ける
  const mp=massProps(pts), cx=mp.cx, cy=mp.cy;
  // 翼を、前後に細長い帯に分ける
  const el=[]; let S=0, cA=0; const cWa=Math.abs(Math.cos(wa));
  const cG=Math.cos(prm.dih), sG=Math.sin(prm.dih);
  const FN=NW, dUm=dU*1e-3, EI=new Float64Array(FN).fill(Infinity), ms=new Float64Array(FN), ma=new Float64Array(FN), th=paper.th||.09, Dp=paper.D||1.6e-4;
  for(let i=0;i<NW;i++){ const uc=h+(i+.5)*dU; let vLE=1e9,vTE=-1e9, mat=0; const sps=[];
    for(const f of faces){ const sp=spanAt(f.p,0,uc); if(sp){ sps.push(sp); mat+=sp[1]-sp[0]; vLE=Math.min(vLE,sp[0]); vTE=Math.max(vTE,sp[1]); } }
    const c=vTE-vLE; if(!(c>3)) continue;
    let nLE=0; for(const sp of sps) if(sp[0]<vLE+1.5) nLE++;          // 前縁に重なっている枚数
    const E=vTE>vH?clamp((vTE-Math.max(vLE,vH))/c,0,1):0, th2=Math.acos(clamp(2*E-1,-1,1));
    const tau=E>0?1-(th2-Math.sin(th2))/Math.PI:0, cmd=E>0?.5*Math.sin(th2)*(1-Math.cos(th2)):0;   // 薄翼理論のフラップの効き
    const wlt=nw>0&&i>=NW-nw, an=prm.dih+(wlt?wa:0), A=c*dU*1e-6, Ap=A*(wlt?cWa:1); S+=2*Ap; cA+=2*Ap*c*1e-3;      // 立てた部分は、上から見た面積ぶんだけ翼として数える
    EI[i]=Dp*mat*1e-3;                                                // 重ねただけの紙は、枚数ぶんだけ曲げにくくなる（貼り合わせではないので足し算）
    ms[i]=(paper.sigma||67e-9)*mat*dU; ma[i]=(rho==null?1.2:rho)*Math.PI*c*c*1e-6/4*dUm;
    for(const s of [1,-1]){ const le=P(uc,vLE,s,false); el.push({k:0,le:[le[0]-cx,le[1]-cy,le[2]],c:c*1e-3,w:dUm,A,n:[0,Math.cos(an),-Math.sin(an)*s],phi:wlt?wa:0,tau:wlt?tau*cWa:tau,cmd:wlt?cmd*cWa:cmd,fi:i,sd:s,tc:mat/c*th/c,hc:nLE*th/c}); } }
  // 翼のしなり：付け根（胴体との折り目）を固定した片持ちばり。帯 j に 1N かけたときの、帯 i の傾き Cth と たわみ Cy
  const Cth=new Float64Array(FN*FN), Cy=new Float64Array(FN*FN), sAt=i=>(i+.5)*dUm;
  for(let j=0;j<FN;j++){ let th0=0, y0=0;                              // 曲率 = 曲げモーメント ÷ 曲げこわさ を、付け根から積分する
    for(let i=0;i<FN;i++){ const g=i<j?(sAt(j)-sAt(i))/EI[i]:0, thi=th0+g*dUm/2; Cth[i*FN+j]=thi; Cy[i*FN+j]=y0+thi*dUm/2; th0+=g*dUm; y0+=thi*dUm; } }
  let yg=0; for(let j=0;j<FN;j++) yg+=Cy[(FN-1)*FN+j]*(ms[j]+ma[j])*G;  // 自分の重さ（空気の見かけの重さこみ）での先端のたわみ → いちばん低い振動の速さ
  const phi=new Float64Array(FN); for(let i=NW-nw;i<NW;i++) phi[i]=wa;
  const flex={n:FN,dih:prm.dih,phi,Cth,Cy,m:ms,tau:clamp(1/(1.243*Math.sqrt(G/Math.max(yg,1e-7))),.004,.3),span:(bd.umax-h)*1e-3};
  // 翼の幅は、立てた部分を上から見た長さで数える。立てた板は、翼の先から空気が回りこむのを減らす（端板の効き：縦横比が 1+1.9·高さ/幅 倍になる。ヘルナー）
  const b=2*((bd.umax-h-nw*dU)+nw*dU*cWa)*cG*1e-3, hW=nw*dU*Math.abs(Math.sin(wa))*1e-3, AR=b*b/S*(1+1.9*hW/b), Kp=2*Math.PI*AR/(2+Math.sqrt(4+AR*AR)), Kv=Math.PI*clamp((2.6-AR)/1.4,0,1);
  // 胴体（縦の板）を、前後に分ける
  const NK=12, dV=(bd.vmax-bd.vmin)/NK;
  for(let i=0;i<NK;i++){ const vc=bd.vmin+(i+.5)*dV; let um=0; for(const f of faces){ const sp=spanAt(f.p,1,vc); if(sp) um=Math.max(um,sp[1]); }
    const d=Math.min(h,um); if(!(d>1)) continue; let nf=0; for(const f of faces){ const sp=spanAt(f.p,1,vc); if(sp&&sp[0]<h/2&&sp[1]>h/2) nf++; }
    el.push({k:1,le:[-vc*1e-3-cx,(-h+d/2)*1e-3-cy,0],c:(bd.vmax-bd.vmin)*1e-3,w:dV*1e-3,A:d*dV*1e-6,n:[0,0,1],tau:0,cmd:0,tc:0,hc:2*Math.max(1,nf)*th/(bd.vmax-bd.vmin)}); }
  const fi=finishInertia(mp.I,el,rho==null?1.2:rho), len=(bd.vmax-bd.vmin)*1e-3;
  return {kind:'plane',flex,wlMM:nw*dU,wa,m:mp.m,cg:[cx,cy],I:fi.I,Iinv:fi.Iinv,el,S,b,AR,Kp,Kv,mac:cA/S,h,vH,bd,elev:prm.elev,prm,P,len,cgPct:(-cx-bd.vmin*1e-3)/len*100};
}
/* ---------- 円筒（リング翼）：長い辺を a 幅で n 回折り返して前の縁を重くし、輪にする ---------- */
function buildRing(paper,o,rho){
  const a=o.a, n=o.n, ov=15, D=(paper.L-ov)/Math.PI*1e-3, c=(paper.W-n*a)*1e-3, r=D/2, am=a*1e-3;
  if(!(c>am+.005)) return null;
  const K=24, pts=[], NX=10, rimShare=(n+1)*a/paper.W;              // 縁の帯に集まる紙の割合
  for(let i=0;i<K;i++){ const ph=i/K*2*Math.PI, y=r*Math.cos(ph), z=r*Math.sin(ph);
    for(let j=0;j<NX;j++){ const xr=-(j+.5)/NX*am; pts.push([xr,y,z,paper.mass*rimShare/(K*NX)]); const xb=-am-(j+.5)/NX*(c-am); pts.push([xb,y,z,paper.mass*(1-rimShare)/(K*NX)]); } }
  const mp=massProps(pts), el=[], KP=16, AR=D/c, Kf=2*Math.PI*AR/(2+Math.sqrt(4+AR*AR));
  for(let i=0;i<KP;i++){ const ph=(i+.5)/KP*2*Math.PI; el.push({k:0,ring:1,le:[-mp.cx,r*Math.cos(ph)-mp.cy,r*Math.sin(ph)],c,w:Math.PI*D/KP,A:c*Math.PI*D/KP,n:[0,Math.cos(ph),Math.sin(ph)],tau:0,cmd:0,tc:(paper.th||.09)*1e-3*(1+n*a/paper.W)/c,hc:(n+1)*(paper.th||.09)*1e-3/c}); }   // 前の縁は、折り返した枚数ぶんの厚みがある
  const fi=finishInertia(mp.I,el,rho==null?1.2:rho);
  // 輪の翼は、同じ直径の平らな翼の2倍の揚力を出す（リブナーの理論）。帯ごとの傾きをそれに合わせる
  return {kind:'ring',m:mp.m,cg:[mp.cx,mp.cy],I:fi.I,Iinv:fi.Iinv,el,S:D*c,b:D,AR,Kp:4*Kf/Math.PI,Kv:0.9,mac:c,elev:0,D,c,a:am,n,len:c,cgPct:-mp.cx/c*100};
}
/* ---------- くしゃくしゃ玉：丸めた紙。翼はなく、空気抵抗だけを受ける ---------- */
function buildBall(paper,o){ const d=(o.tight?0.2:0.27)*Math.sqrt(paper.W*paper.L)*1e-3, m=paper.mass, I=.4*m*d*d/4;
  return {kind:'ball',m,cg:[0,0],I:[I,I,I,0],Iinv:[1/I,0,1/I,1/I],el:[],S:Math.PI*d*d/4,d,CD:0.6,Kp:0,Kv:0,elev:0,len:d,mac:d,cgPct:50}; }

/* ---------- 地面効果 ---------- */
/* 地面すれすれでは、地面が鏡になって翼のうずの「鏡像」ができ、翼の先から回りこむ流れ（吹きおろし）を弱める。
   groundPhi(h/b) = 地面の近くでの「揚力にともなう抵抗」÷ 遠い所でのそれ（h=翼の高さ、b=翼の幅）。
   だ円の揚力分布をもつ翼と、その鏡像のうず（プラントルの揚力線理論）から表を作って引く。h/b が 0.02〜0.25 の間で、ヴィーゼルスベルガーの式と 0.3% 以内で合う */
const GE=(()=>{ const N=96, ye=[], yc=[], Gm=[], lx=[], ph=[];
  for(let i=0;i<=N;i++) ye.push(-.5*Math.cos(Math.PI*i/N));                                  // 翼（幅1）を帯に分ける。端ほど細かく
  for(let i=0;i<N;i++){ const y=-.5*Math.cos(Math.PI*(i+.5)/N); yc.push(y); Gm.push(Math.sqrt(1-4*y*y)); }
  for(let k=0;k<=36;k++){ const x=.02*Math.pow(150,k/36), g2=4*x*x; let Ds=0, Di=0;          // h/b = 0.02 〜 3。鏡像は 2h 下にある
    for(let i=0;i<N;i++){ let ws=0, wi=0; for(let j=0;j<N;j++){ const a=yc[i]-ye[j], b=yc[i]-ye[j+1]; ws+=Gm[j]*(1/a-1/b); wi+=Gm[j]*(a/(a*a+g2)-b/(b*b+g2)); }   // 自分のうずの吹きおろしと、鏡像のうずの吹き上げ
      const dy=ye[i+1]-ye[i]; Ds+=Gm[i]*ws*dy; Di+=Gm[i]*wi*dy; }
    lx.push(Math.log(x)); ph.push(1-Di/Ds); }
  return {lx,ph}; })();
function groundPhi(hb){ if(!(hb<3)) return 1-1/(32*hb*hb);                                    // 遠い所では、1/(32(h/b)²) だけ減る
  const t=(Math.log(Math.max(hb,.02))-GE.lx[0])/(GE.lx[36]-GE.lx[0])*36, i=Math.min(35,Math.floor(t)); return GE.ph[i]+(GE.ph[i+1]-GE.ph[i])*(t-i); }
/* 抵抗が φ 倍になるのは、見かけの縦横比が 1/φ 倍になるのと同じこと。その縦横比で、付着した流れの揚力の傾き Kp を出し直す。
   up は機体の上向きの軸が、どれだけ真上を向いているか（−1〜1）。翼が地面と平行でないときは、その2乗で弱める（ここは目安） */
function groundKp(pl,h,up){ const f=1-(1-groundPhi(Math.max(h,0)/pl.b))*up*up, AR=pl.AR/f; return 2*Math.PI*AR/(2+Math.sqrt(4+AR*AR)); }

/* ---------- 空気の力 ---------- */
/* vb: 機体から見た、空気に対する重心の速度。w: 機体の回る速さ。out に力 F とモーメント M（機体の向き）を入れる。kp は地面の近くでの Kp（なければ機体の Kp） */
function aero(pl,vb,w,out,env,fx,kp){
  const rho=env.rho, mu=env.mu;
  if(pl.kind==='ball'){ const V=Math.hypot(vb[0],vb[1],vb[2]), q=.5*rho*V*pl.S*pl.CD; out.F[0]=-q*vb[0]; out.F[1]=-q*vb[1]; out.F[2]=-q*vb[2];
    out.M[0]=-1e-7*w[0]; out.M[1]=-1e-7*w[1]; out.M[2]=-1e-7*w[2]; return out; }
  let Fx=0,Fy=0,Fz=0,Mx=0,My=0,Mz=0; const de0=pl.elev, wp=env.warp, Kp=kp||pl.Kp, k3=Kp/(2*Math.PI), fl=fx&&pl.flex;
  for(const e of pl.el){
    const c=e.c, lx=e.le[0]; let n0=e.n[0], n1=e.n[1], n2=e.n[2], ly=e.le[1], lz=e.le[2], j=-1;
    if(fl&&e.fi!=null){ j=e.fi+(e.sd>0?0:fl.n); const a=fl.dih+fx.th[j]+(e.phi||0); n1=Math.cos(a); n2=-Math.sin(a)*e.sd; ly+=fx.y[j]*e.n[1]; lz+=fx.y[j]*e.n[2]; }   // しなったぶんだけ、翼の面が傾き、位置が上がる
    const qx=lx-c*(e.k?0:vb[0]>=0?.75:.25);                      // 迎角は、流れの向きに見て 3/4 弦の点で決める（薄翼理論）
    const vx=vb[0]+w[1]*lz-w[2]*ly, vy=vb[1]+w[2]*qx-w[0]*lz, vz=vb[2]+w[0]*ly-w[1]*qx;
    const Uc=vx, Un=-(vx*n0+vy*n1+vz*n2), V2=Uc*Uc+Un*Un; if(V2<1e-9){ if(j>=0) fx.N[j]=0; continue; }
    const V=Math.sqrt(V2), al=Math.atan2(Un,Uc), q=.5*rho*V2*e.A; let CN, fcp, Mf=0;
    const cf=2.656/Math.sqrt(Math.max(1500,rho*V*c/mu));         // 板の両面の摩擦（層流・ブラジウスの式 1.328/√Re を2面ぶん）
    if(e.k===0){
      const de=wp?de0+(e.sd>0?wp[1]:wp[0]):de0;                    // 折りのゆがみ：左右で、後ろの縁の反りが少し違う
      const aw=1-sstep(.24,.56,Math.abs(al)), ae=al-e.tau*de*aw, s=Math.sin(ae), co=Math.cos(ae);
      const cp=Kp*s*Math.abs(co), cv=(pl.Kv+(1-aw)*Math.max(0,Math.PI-pl.Kv))*s*Math.abs(s);   // 付着した流れの力と、前縁のうずの力（ポルハムス）。失速後は、細長い翼でも板としての抵抗が出る
      CN=CNMAX*Math.tanh((cp+cv)/CNMAX);                         // 板が出せる上限で、なだらかに頭打ち
      const fa=(Math.abs(cp)*.25+Math.abs(cv)*.5)/(Math.abs(cp)+Math.abs(cv)+1e-9), f=fa*aw+.45*(1-aw);
      fcp=Uc>=0?f:1-f;                                           // 力の中心。うずの力は弦の中ほど、失速すると後ろへ
      Mf=q*c*e.cmd*k3*de*aw*(Uc>=0?1:-1);                        // 反り上げた縁が作る、機首上げのモーメント
      if(!e.ring) Mf-=rho*e.w*c*c*c*c/32*Math.abs(w[2])*w[2];     // 板そのものが回るときの抵抗（弦の前後が逆向きに空気を押す）
    }else{ const s=Math.sin(al); CN=.22*s*Math.cos(al)+1.6*s*Math.abs(s); fcp=.5; }
    // 板に沿う抵抗：摩擦 ×（厚みの形状係数 1+2t/c：ヘルナー）＋ 前縁の厚み（重なりの枚数×紙の厚さ）の前面にかかる動圧
    const cd=KFR*cf*(1+2*(e.tc||0))+CEDGE*(e.hc||0), fn=q*CN+q*cd*Un/V, fc=q*cd*Uc/V;
    if(j>=0) fx.N[j]=fn;
    const fx_=fn*n0-fc, fy=fn*n1, fz=fn*n2;
    const rx=e.k?lx:lx-c*fcp;
    Fx+=fx_; Fy+=fy; Fz+=fz;
    Mx+=ly*fz-lz*fy; My+=lz*fx_-rx*fz; Mz+=rx*fy-ly*fx_+Mf*(j>=0?n1/e.n[1]:1);
    if(e.k===0){ const Mq=-k3*Math.PI/16*rho*Math.abs(Uc)*c*c*c*e.w*(w[2]*n1-w[1]*n2); My-=Mq*n2; Mz+=Mq*n1; }   // 板が回るときの偶力（薄翼理論の Cm=-(π/8)cω/V）
  }
  out.F[0]=Fx; out.F[1]=Fy; out.F[2]=Fz; out.M[0]=Mx; out.M[1]=My; out.M[2]=Mz; return out;
}
/* ---------- 翼のしなり（片持ちばりの曲げ）。帯ごとの「空気の力 − 帯の重さ×機体の加速度」が翼を曲げる ---------- */
function newFlex(pl){ const n=pl.flex.n*2; return {th:new Float64Array(n),y:new Float64Array(n),N:new Float64Array(n),L:new Float64Array(n)}; }
function flexUpdate(pl,fx,F,h){ const fl=pl.flex, n=fl.n, k=h<0?-h:Math.min(1,h/fl.tau);      // h<0 のときは、つり合いを求める反復（緩和係数 -h）
  for(let sd=0;sd<2;sd++){ const o=sd*n, sg=sd?-1:1;
    for(let i=0;i<n;i++){ const a=fl.dih+fx.th[o+i]+fl.phi[i]; fx.L[o+i]=fx.N[o+i]-fl.m[i]*(F[1]*Math.cos(a)-F[2]*Math.sin(a)*sg)/pl.m; }
    for(let i=0;i<n;i++){ let t=0,y=0; for(let j=0;j<n;j++){ const L=fx.L[o+j]; t+=fl.Cth[i*n+j]*L; y+=fl.Cy[i*n+j]*L; }
      const sm=(i+.5)*fl.span/n; t=clamp(t,-1.35,1.35); y=clamp(y,-.85*sm,.85*sm);          // はりの式は小さなたわみ用なので、折れ上がりきった所で止める
      fx.th[o+i]+=(t-fx.th[o+i])*k; fx.y[o+i]+=(y-fx.y[o+i])*k; } } }

/* ---------- 設計の診断（まっすぐ滑空したときの釣り合い） ---------- */
function analyze(pl,env){
  const o={F:[0,0,0],M:[0,0,0]}, W=pl.m*env.g, res={m:pl.m,S:pl.S,b:pl.b,AR:pl.AR,mac:pl.mac,cgPct:pl.cgPct,load:pl.m/pl.S,kind:pl.kind};
  if(env.rho<1e-6){ res.state='vacuum'; res.sm=0; return res; }                    // 空気がなければ、翼は何もしない
  if(pl.kind==='ball'){ res.state='ball'; res.vterm=Math.sqrt(W/(.5*env.rho*pl.S*pl.CD)); return res; }
  let V0=5, rows, trim;
  for(let it=0;it<4;it++){ rows=[]; trim=null;
    const fx=pl.flex?newFlex(pl):null, vv=[0,0,0], w0=[0,0,0];
    for(let d=-4;d<=40;d+=.25){ const a=d*Math.PI/180; vv[0]=V0*Math.cos(a); vv[1]=-V0*Math.sin(a); aero(pl,vv,w0,o,env,fx);
      if(fx) for(let k=0;k<5;k++){ flexUpdate(pl,fx,o.F,-.6); aero(pl,vv,w0,o,env,fx); }      // しなりと空気の力がつり合うまで反復
      if(fx){ let m=0; for(let i=0;i<pl.flex.n;i++) m=Math.max(m,Math.abs(fx.th[i])); rows.fl=rows.fl||[]; rows.fl.push(m); }
      const L=o.F[0]*Math.sin(a)+o.F[1]*Math.cos(a), D=-(o.F[0]*Math.cos(a)-o.F[1]*Math.sin(a)); rows.push([d,o.M[2],L,D]); }
    if(pl.kind==='ring') break;
    for(let i=1;i<rows.length;i++){ const a=rows[i-1], b=rows[i]; if(a[1]>0&&b[1]<=0&&b[0]>0.6){ const t=a[1]/(a[1]-b[1]);
        trim={alpha:a[0]+(b[0]-a[0])*t,L:a[2]+(b[2]-a[2])*t,D:a[3]+(b[3]-a[3])*t}; break; } }
    if(!(trim&&trim.L>0)||W<1e-9) break;
    const V=V0*Math.sqrt(W/Math.hypot(trim.L,trim.D)); if(Math.abs(V-V0)<.004*V0||it===3) break; V0=clamp(V,.3,60); }   // 釣り合う速さで計算し直す
  res.rows=rows;
  const r0=rows.find(r=>r[0]===2), r1=rows.find(r=>r[0]===5);      // 中立点：ここより重心が前なら、機首を戻す力がはたらく
  res.sm=-((r1[1]-r0[1])/(r1[2]-r0[2]))/pl.mac*100;
  if(pl.kind==='ring'){ res.state=res.sm>0?'ring':'ringbad'; return res; }
  if(trim&&trim.L>0){ const R=Math.hypot(trim.L,trim.D), V=V0*Math.sqrt(W/R); res.zerog=W<1e-9;
    Object.assign(res,{trim:trim.alpha,LD:trim.L/trim.D,V,sink:V*trim.D/R,CL:trim.L/(.5*env.rho*V0*V0*pl.S)});
    if(rows.fl){ const i=clamp(Math.round((trim.alpha+4)/.25),0,rows.fl.length-1); res.flexDeg=rows.fl[i]*180/Math.PI; }   // 滑空中の、翼の先の傾き
    res.state=trim.alpha<2.2?'dive':trim.alpha>16?'stall':'ok';
  }else{ const m5=rows.find(r=>r[0]===5)[1]; res.state=m5>0?'tailheavy':'dive'; }
  return res;
}

/* ---------- 飛行（剛体の6自由度） ---------- */
function qrot(q,v,o){ const w=q[0],x=q[1],y=q[2],z=q[3], tx=2*(y*v[2]-z*v[1]), ty=2*(z*v[0]-x*v[2]), tz=2*(x*v[1]-y*v[0]);
  o[0]=v[0]+w*tx+(y*tz-z*ty); o[1]=v[1]+w*ty+(z*tx-x*tz); o[2]=v[2]+w*tz+(x*ty-y*tx); return o; }
const _qc=[0,0,0,0];
function qinv(q,v,o){ _qc[0]=q[0]; _qc[1]=-q[1]; _qc[2]=-q[2]; _qc[3]=-q[3]; return qrot(_qc,v,o); }
/* 投げる：速さ(m/s)、角度(度)、手の高さ(m)。roll=投げたときの傾き(rad)、spin=軸まわりの回転(回/秒) */
const qmul=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
function launch(speed,angDeg,height,o){ o=o||{};
  const dz=o.dz; if(dz){ speed*=1+dz.dv; angDeg+=dz.dAng; }                       // 外乱：速さと角度のぶれ
  const g=angDeg*Math.PI/180, roll=(o.roll||0)+(dz?dz.roll:0), hd=(o.head||0)+(dz?dz.head:0);
  let q=[Math.cos(g/2),0,0,Math.sin(g/2)];
  if(roll) q=qmul(q,[Math.cos(roll/2),Math.sin(roll/2),0,0]);
  if(hd) q=qmul([Math.cos(hd/2),0,Math.sin(hd/2),0],q);                           // 向きのぶれ（上から見て左右）
  return {p:[0,height,0],v:[speed*Math.cos(g)*Math.cos(hd),speed*Math.sin(g),-speed*Math.cos(g)*Math.sin(hd)],q,w:[(o.spin||0)*2*Math.PI,o.yaw||0,0],t:0,alpha:0,speed,hmax:height,landed:false,path:[]};
}
const _vb=[0,0,0], _o={F:[0,0,0],M:[0,0,0]}, _fw=[0,0,0], _rel=[0,0,0], _wd=[0,0,0];
function step(st,pl,dt,env){
  const q=st.q, w=st.w, I=pl.I, Ii=pl.Iinv, wm=Math.hypot(pl.kind==='ring'?0:w[0],w[1],w[2]);   // 円筒は軸まわりの回転を数えない
  const nsub=pl.kind==='ball'?1:Math.min(10,1+Math.floor(wm/15)), h=dt/nsub;      // 速く回っているときは、刻みを細かくする
  const kp=pl.kind==='plane'&&!env.noGround&&!env.noGE?groundKp(pl,st.p[1],1-2*(q[1]*q[1]+q[3]*q[3])):0; st.ge=kp?kp/pl.Kp:1;   // 地面効果（円筒と玉には入れていない）
  for(let s=0;s<nsub;s++){
    if(env.calm){ _rel[0]=st.v[0]; _rel[1]=st.v[1]; _rel[2]=st.v[2]; } else { env.windAt(st.p,st.t,_wd); _rel[0]=st.v[0]-_wd[0]; _rel[1]=st.v[1]-_wd[1]; _rel[2]=st.v[2]-_wd[2]; }
    const fx=pl.flex?(st.fx||(st.fx=newFlex(pl))):null;
    qinv(q,_rel,_vb); aero(pl,_vb,w,_o,env,fx,kp); if(fx) flexUpdate(pl,fx,_o.F,h); qrot(q,_o.F,_fw);
    st.v[0]+=_fw[0]/pl.m*h; st.v[1]+=(_fw[1]/pl.m-env.g)*h; st.v[2]+=_fw[2]/pl.m*h;
    st.p[0]+=st.v[0]*h; st.p[1]+=st.v[1]*h; st.p[2]+=st.v[2]*h;
    // 回転：I·dw/dt = M − w×(I·w)
    const hx=I[0]*w[0]+I[3]*w[1], hy=I[3]*w[0]+I[1]*w[1], hz=I[2]*w[2];
    const tx=_o.M[0]-(w[1]*hz-w[2]*hy), ty=_o.M[1]-(w[2]*hx-w[0]*hz), tz=_o.M[2]-(w[0]*hy-w[1]*hx);
    w[0]+=(Ii[0]*tx+Ii[1]*ty)*h; w[1]+=(Ii[1]*tx+Ii[2]*ty)*h; w[2]+=Ii[3]*tz*h;
    if(pl.kind!=='ball'){ const wn=Math.hypot(pl.kind==='ring'?0:w[0],w[1],w[2]); if(wn>70){ const k=70/wn; if(pl.kind!=='ring') w[0]*=k; w[1]*=k; w[2]*=k; } }   // 計算が暴れないための上限
    const qw=q[0],qx=q[1],qy=q[2],qz=q[3], hh=.5*h;
    q[0]+=(-qx*w[0]-qy*w[1]-qz*w[2])*hh; q[1]+=(qw*w[0]+qy*w[2]-qz*w[1])*hh; q[2]+=(qw*w[1]+qz*w[0]-qx*w[2])*hh; q[3]+=(qw*w[2]+qx*w[1]-qy*w[0])*hh;
    const n=Math.hypot(q[0],q[1],q[2],q[3]); q[0]/=n; q[1]/=n; q[2]/=n; q[3]/=n;
    st.t+=h;
  }
  if(st.fx){ let m=0; const n=pl.flex.n; for(let i=0;i<2*n;i++) if(Math.abs(st.fx.th[i])>Math.abs(m)) m=st.fx.th[i]; st.flex=m; if(Math.abs(m)>(st.flexMax||0)) st.flexMax=Math.abs(m); }
  st.alpha=Math.atan2(-_vb[1],Math.hypot(_vb[0],_vb[2])); st.speed=Math.hypot(_rel[0],_rel[1],_rel[2]); if(st.p[1]>st.hmax) st.hmax=st.p[1];
  const floor=pl.kind==='ball'?pl.d/2:pl.kind==='ring'?pl.D/2:0.015;
  if(st.p[1]<=floor&&!env.noGround){ st.p[1]=floor; st.landed=true; }
}
function fly(pl,speed,ang,height,env,opt){      // 着地まで一気に計算する（検証用・記録用）
  opt=opt||{}; const st=launch(speed,ang,height,opt), dt=opt.dt||.0005; let k=0;
  while(!st.landed&&st.t<(opt.tmax||300)){ step(st,pl,dt,env); if(opt.path&&(k++%40===0)) st.path.push([st.p[0],st.p[1],st.p[2]]); }
  st.dist=Math.hypot(st.p[0],st.p[2]); return st;
}

/* ---------- お手本の折り方（紙の大きさに合わせて決まる） ---------- */
function presets(paper){ const w=paper.pw, d=Math.round(w*.15);   // d＝へそ（折り返す三角）の大きさ
  return [
    {id:'dart',name:'やり型',note:'角を2回、中心線へ折る。細くて速い',folds:[[[w,0],[0,w]],[[w,w],[0,w*Math.SQRT2]]],prm:{h:Math.round(w*.15),dih:8,elev:2.5,clips:0}},
    {id:'heso',name:'へそ型',note:'先を折り下げ、出た三角（へそ）だけを折り返して留める。ゆっくり安定',folds:[[[w,0],[0,w]],[[0,0],[0,2*(w+d)]],[[w,w+d],[0,2*w+d]],[[0,2*(w+d)],[0,2*w],2]],prm:{h:Math.round(w*.19),dih:8,elev:3,clips:0}},
  ]; }
function applyFolds(paper,list){ let f=newPaper(paper); for(const [A,B,u] of list){ const r=fold(f,A,B,u&1,u&2);   // u：1＝山折り、2＝上の紙だけ
    if(r.err) throw new Error('fold '+r.err); f=r.faces; } return f; }
const toPrm=o=>({wl:o.wl||0,wa:(o.wa||0)*Math.PI/180,h:o.h,dih:o.dih*Math.PI/180,elev:o.elev*Math.PI/180,e:o.e||22,clips:o.clips||0,clipV:o.clipV||25});

root.KH={flapSeed,overlaps,groundPhi,groundKp,G,FOLD_MM,DIST,disturb,rng,stack,centroid,newFlex,flexUpdate,MATERIALS,SIZES,makePaper,air,makeEnv,newPaper,fold,clipHalf,area,bounds,spanAt,inside,buildPlane,buildRing,buildBall,aero,analyze,launch,step,fly,qrot,qinv,presets,applyFolds,toPrm,mapper};
})(typeof window!=='undefined'?window:globalThis);
