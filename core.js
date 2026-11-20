/* 紙飛行機ラボ — 計算の中身（折り・重さの分布・空気の力・飛行）
   画面を持たないので、ブラウザでも node でも同じものが動く。
   長さは、折りの計算だけ mm、物理の計算は m・kg・秒。機体の軸は x=前、y=上、z=右。 */
(function(root){
'use strict';
const G=9.80665, CNMAX=1.25;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sstep=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

/* ---------- 紙と空気 ---------- */
const MATERIALS=[ // 坪量（1m²あたりの重さ）
  {id:'news',name:'新聞紙',gsm:46},{id:'origami',name:'折り紙',gsm:60},{id:'copy',name:'コピー用紙',gsm:67},
  {id:'fine',name:'厚口のコピー用紙',gsm:80},{id:'guinness',name:'記録挑戦用（上限）',gsm:100},{id:'draw',name:'画用紙',gsm:160}];
const SIZES=[{id:'a4',name:'A4',W:210,L:297},{id:'a5',name:'A5',W:148,L:210},{id:'b5',name:'B5',W:182,L:257},
  {id:'a3',name:'A3',W:297,L:420},{id:'ori15',name:'折り紙 15cm',W:150,L:150},{id:'letter',name:'レター',W:216,L:279}];
function makePaper(sizeId,matId){ const s=SIZES.find(x=>x.id===sizeId)||SIZES[0], m=MATERIALS.find(x=>x.id===matId)||MATERIALS[2];
  return {W:s.W,L:s.L,pw:s.W/2,gsm:m.gsm,sigma:m.gsm*1e-9,mass:m.gsm*s.W*s.L*1e-9,size:s,mat:m}; }
/* 気温と標高から、空気の密度と粘り気を出す（標準大気の式、乾いた空気） */
function air(tempC,altM){ const T=tempC+273.15, p=101325*Math.pow(1-2.25577e-5*(altM||0),5.25588);
  return {T,p,rho:p/(287.05*T),mu:1.716e-5*Math.pow(T/273.15,1.5)*(273.15+110.4)/(T+110.4)}; }
/* 風：向かい風 head（m/s、正で正面から）、横風 cross（正で左から）、突風の強さ gust（m/s）。地面に近いほど弱い */
function makeEnv(o){ o=o||{}; const a=air(o.tempC==null?20:o.tempC,o.alt||0), head=o.head||0, cross=o.cross||0, gust=o.gust||0;
  if(o.rho!=null){ a.rho=o.rho; if(o.mu!=null) a.mu=o.mu; }      // 月や火星など、地球の大気の式が使えない場所
  const ph=[1.3,4.1,2.2,5.7,0.4,3.3];
  return {rho:a.rho,mu:a.mu,g:o.g==null?G:o.g,air:a,head,cross,gust,calm:!head&&!cross&&!gust,
    windAt(p,t,out){ const y=Math.max(p[1],.05), k=Math.min(1.25,Math.pow(y/2,.2));
      let gx=0,gy=0,gz=0; if(gust){ const s=p[0]*.35, u=p[2]*.3;
        gx=gust*(.55*Math.sin(1.9*t+s+ph[0])+.45*Math.sin(4.3*t-1.7*s+ph[1]));
        gy=gust*.5*(.6*Math.sin(2.6*t+1.3*s+ph[2])+.4*Math.sin(5.9*t+u+ph[3]))*Math.min(1,y/1.5);
        gz=gust*(.5*Math.sin(1.4*t+u+ph[4])+.5*Math.sin(3.7*t-s+ph[5])); }
      out[0]=-head*k+gx; out[1]=gy; out[2]=cross*k+gz; return out; }}; }

/* ---------- 折り ---------- */
function area(p){ let a=0; for(let i=0;i<p.length;i++){ const q=p[(i+1)%p.length]; a+=p[i][0]*q[1]-q[0]*p[i][1]; } return a/2; }
function clipHalf(poly,px,py,nx,ny,sign){        // 直線の片側だけを残す
  const out=[], n=poly.length;
  for(let i=0;i<n;i++){ const a=poly[i], b=poly[(i+1)%n];
    const da=sign*((a[0]-px)*nx+(a[1]-py)*ny), db=sign*((b[0]-px)*nx+(b[1]-py)*ny);
    if(da>=0) out.push(a);
    if((da>0&&db<0)||(da<0&&db>0)){ const t=da/(da-db); out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]); } }
  return out;
}
/* 左右対称なので、紙の右半分だけを持つ（u=中心線からの距離、v=先端からの距離） */
function newPaper(paper){ return [{p:[[0,0],[paper.pw,0],[paper.pw,paper.L],[0,paper.L]],flip:false,z:0}]; }
function rankZ(faces){ const zs=[...new Set(faces.map(f=>f.z))].sort((a,b)=>a-b); const m=new Map(zs.map((z,i)=>[z,i])); faces.forEach(f=>f.z=m.get(f.z)); return faces; }
/* A をつまんで B へ持っていく。折り線は A と B の垂直二等分線で、A の側の紙が、重なりごと全部裏返る */
function fold(faces,A,B){
  const dx=A[0]-B[0], dy=A[1]-B[1], L=Math.hypot(dx,dy); if(L<4) return {err:'short'};
  const nx=dx/L, ny=dy/L, px=(A[0]+B[0])/2, py=(A[1]+B[1])/2;
  const stay=[], move=[]; let zmax=0; for(const f of faces) zmax=Math.max(zmax,f.z);
  for(const f of faces){
    const a=clipHalf(f.p,px,py,nx,ny,-1), b=clipHalf(f.p,px,py,nx,ny,1);
    if(a.length>=3&&Math.abs(area(a))>.5) stay.push({p:a,flip:f.flip,z:f.z});
    if(b.length>=3&&Math.abs(area(b))>.5){
      const r=b.map(q=>{ const d=(q[0]-px)*nx+(q[1]-py)*ny; return [q[0]-2*d*nx,q[1]-2*d*ny]; });
      for(let i=0;i<r.length;i++){
        if(r[i][0]<-0.05) return {err:'center'};                   // 中心線をこえる折りは、左右が重なるので不可
        if(b[i][0]<.05&&r[i][0]>.5) return {err:'tear'}; }         // 中心線の上の紙が中心線から離れる折りは、左右がそこで裂けるので不可
      move.push({p:r,flip:!f.flip,z:2*zmax+1-f.z}); } }
  if(!move.length) return {err:'none'}; if(!stay.length) return {err:'all'};
  return {faces:rankZ(stay.concat(move)),line:{px,py,nx,ny}};
}
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
/* prm: h=胴体の深さ(mm) dih=上反角(rad) elev=後ろの縁の反り上げ(rad) e=反り上げる幅(mm) clips=クリップの数 clipV=付ける位置(mm) */
function mapper(prm,vH){
  const cG=Math.cos(prm.dih), sG=Math.sin(prm.dih), cd=Math.cos(prm.elev), sd=Math.sin(prm.elev), h=prm.h;
  return function(u,v,side,bend){          // side: +1 右、-1 左。戻り値は m
    let x,y,z;
    if(u<=h){ x=-v; y=-(h-u); z=0; }
    else { const s=u-h; let xv=v, yl=0; if(bend!==false&&v>vH){ const d=v-vH; xv=vH+d*cd; yl=d*sd; } x=-xv; y=s*sG+yl; z=s*cG; }
    return [x*1e-3,y*1e-3,z*side*1e-3];
  };
}
function buildPlane(faces,prm,paper,rho){
  const bd=bounds(faces), h=clamp(prm.h,3,Math.max(3,bd.umax-8)), vH=bd.vmax-prm.e;
  const P=mapper(Object.assign({},prm,{h}),vH);
  const pts=[], g=Math.max(4,Math.round(paper.pw/18)); let msum=0;          // 重さの点（升目）
  for(const f of faces){ let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for(const q of f.p){ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]); y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
    for(let u=Math.floor(x0/g)*g+g/2;u<x1;u+=g) for(let v=Math.floor(y0/g)*g+g/2;v<y1;v+=g) if(inside(f.p,u,v)){ for(const s of [1,-1]){ const p=P(u,v,s); pts.push([p[0],p[1],p[2],1]); msum+=1; } } }
  for(const p of pts) p[3]=paper.mass/msum;
  for(let i=0;i<(prm.clips||0);i++) pts.push([-(prm.clipV||25)*1e-3,-h*1e-3,0,0.0005]);   // 小さいクリップ 約0.5g
  const mp=massProps(pts), cx=mp.cx, cy=mp.cy;
  // 翼を、前後に細長い帯に分ける
  const el=[], NW=12, dU=(bd.umax-h)/NW; let S=0, cA=0;
  const cG=Math.cos(prm.dih), sG=Math.sin(prm.dih);
  for(let i=0;i<NW;i++){ const uc=h+(i+.5)*dU; let vLE=1e9,vTE=-1e9;
    for(const f of faces){ const sp=spanAt(f.p,0,uc); if(sp){ vLE=Math.min(vLE,sp[0]); vTE=Math.max(vTE,sp[1]); } }
    const c=vTE-vLE; if(!(c>3)) continue;
    const E=vTE>vH?clamp((vTE-Math.max(vLE,vH))/c,0,1):0, th=Math.acos(clamp(2*E-1,-1,1));
    const tau=E>0?1-(th-Math.sin(th))/Math.PI:0, cmd=E>0?.5*Math.sin(th)*(1-Math.cos(th)):0;   // 薄翼理論のフラップの効き
    const A=c*dU*1e-6; S+=2*A; cA+=2*A*c*1e-3;
    for(const s of [1,-1]){ const le=P(uc,vLE,s,false); el.push({k:0,le:[le[0]-cx,le[1]-cy,le[2]],c:c*1e-3,w:dU*1e-3,A,n:[0,cG,-sG*s],tau,cmd}); } }
  const b=2*(bd.umax-h)*cG*1e-3, AR=b*b/S, Kp=2*Math.PI*AR/(2+Math.sqrt(4+AR*AR)), Kv=Math.PI*clamp((2.6-AR)/1.4,0,1);
  // 胴体（縦の板）を、前後に分ける
  const NK=12, dV=(bd.vmax-bd.vmin)/NK;
  for(let i=0;i<NK;i++){ const vc=bd.vmin+(i+.5)*dV; let um=0; for(const f of faces){ const sp=spanAt(f.p,1,vc); if(sp) um=Math.max(um,sp[1]); }
    const d=Math.min(h,um); if(!(d>1)) continue;
    el.push({k:1,le:[-vc*1e-3-cx,(-h+d/2)*1e-3-cy,0],c:dV*1e-3,w:dV*1e-3,A:d*dV*1e-6,n:[0,0,1],tau:0,cmd:0}); }
  const fi=finishInertia(mp.I,el,rho==null?1.2:rho), len=(bd.vmax-bd.vmin)*1e-3;
  return {kind:'plane',m:mp.m,cg:[cx,cy],I:fi.I,Iinv:fi.Iinv,el,S,b,AR,Kp,Kv,mac:cA/S,h,vH,bd,elev:prm.elev,prm,P,len,cgPct:(-cx-bd.vmin*1e-3)/len*100};
}
/* ---------- 円筒（リング翼）：長い辺を a 幅で n 回折り返して前の縁を重くし、輪にする ---------- */
function buildRing(paper,o,rho){
  const a=o.a, n=o.n, ov=15, D=(paper.L-ov)/Math.PI*1e-3, c=(paper.W-n*a)*1e-3, r=D/2, am=a*1e-3;
  if(!(c>am+.005)) return null;
  const K=24, pts=[], NX=10, rimShare=(n+1)*a/paper.W;              // 縁の帯に集まる紙の割合
  for(let i=0;i<K;i++){ const ph=i/K*2*Math.PI, y=r*Math.cos(ph), z=r*Math.sin(ph);
    for(let j=0;j<NX;j++){ const xr=-(j+.5)/NX*am; pts.push([xr,y,z,paper.mass*rimShare/(K*NX)]); const xb=-am-(j+.5)/NX*(c-am); pts.push([xb,y,z,paper.mass*(1-rimShare)/(K*NX)]); } }
  const mp=massProps(pts), el=[], KP=16, AR=D/c, Kf=2*Math.PI*AR/(2+Math.sqrt(4+AR*AR));
  for(let i=0;i<KP;i++){ const ph=(i+.5)/KP*2*Math.PI; el.push({k:0,ring:1,le:[-mp.cx,r*Math.cos(ph)-mp.cy,r*Math.sin(ph)],c,w:Math.PI*D/KP,A:c*Math.PI*D/KP,n:[0,Math.cos(ph),Math.sin(ph)],tau:0,cmd:0}); }
  const fi=finishInertia(mp.I,el,rho==null?1.2:rho);
  // 輪の翼は、同じ直径の平らな翼の2倍の揚力を出す（リブナーの理論）。帯ごとの傾きをそれに合わせる
  return {kind:'ring',m:mp.m,cg:[mp.cx,mp.cy],I:fi.I,Iinv:fi.Iinv,el,S:D*c,b:D,AR,Kp:4*Kf/Math.PI,Kv:0.9,mac:c,elev:0,D,c,a:am,n,len:c,cgPct:-mp.cx/c*100};
}
/* ---------- くしゃくしゃ玉：丸めた紙。翼はなく、空気抵抗だけを受ける ---------- */
function buildBall(paper,o){ const d=(o.tight?0.2:0.27)*Math.sqrt(paper.W*paper.L)*1e-3, m=paper.mass, I=.4*m*d*d/4;
  return {kind:'ball',m,cg:[0,0],I:[I,I,I,0],Iinv:[1/I,0,1/I,1/I],el:[],S:Math.PI*d*d/4,d,CD:0.6,Kp:0,Kv:0,elev:0,len:d,mac:d,cgPct:50}; }

/* ---------- 空気の力 ---------- */
/* vb: 機体から見た、空気に対する重心の速度。w: 機体の回る速さ。out に力 F とモーメント M（機体の向き）を入れる */
function aero(pl,vb,w,out,env){
  const rho=env.rho, mu=env.mu;
  if(pl.kind==='ball'){ const V=Math.hypot(vb[0],vb[1],vb[2]), q=.5*rho*V*pl.S*pl.CD; out.F[0]=-q*vb[0]; out.F[1]=-q*vb[1]; out.F[2]=-q*vb[2];
    out.M[0]=-1e-7*w[0]; out.M[1]=-1e-7*w[1]; out.M[2]=-1e-7*w[2]; return out; }
  let Fx=0,Fy=0,Fz=0,Mx=0,My=0,Mz=0; const de=pl.elev, k3=pl.Kp/(2*Math.PI);
  for(const e of pl.el){
    const n=e.n, c=e.c, lx=e.le[0], ly=e.le[1], lz=e.le[2];
    const qx=lx-c*(e.k?0:.75);                                   // 迎角は 3/4 弦の点の流れで決める（薄翼理論）
    const vx=vb[0]+w[1]*lz-w[2]*ly, vy=vb[1]+w[2]*qx-w[0]*lz, vz=vb[2]+w[0]*ly-w[1]*qx;
    const Uc=vx, Un=-(vx*n[0]+vy*n[1]+vz*n[2]), V2=Uc*Uc+Un*Un; if(V2<1e-9) continue;
    const V=Math.sqrt(V2), al=Math.atan2(Un,Uc), q=.5*rho*V2*e.A; let CN, fcp, Mf=0;
    const cf=2.656/Math.sqrt(Math.max(1500,rho*V*c/mu));         // 板の両面の摩擦（層流・ブラジウスの式）
    if(e.k===0){
      const aw=1-sstep(.24,.56,Math.abs(al)), ae=al-e.tau*de*aw, s=Math.sin(ae), co=Math.cos(ae);
      const cp=pl.Kp*s*co, cv=pl.Kv*s*Math.abs(s);               // 付着した流れの力と、前縁のうずの力（ポルハムス）
      CN=CNMAX*Math.tanh((cp+cv)/CNMAX);                         // 板が出せる上限で、なだらかに頭打ち
      const fa=(Math.abs(cp)*.25+Math.abs(cv)*.5)/(Math.abs(cp)+Math.abs(cv)+1e-9), f=fa*aw+.45*(1-aw);
      fcp=Uc>=0?f:1-f;                                           // 力の中心。うずの力は弦の中ほど、失速すると後ろへ
      Mf=q*c*e.cmd*k3*de*aw*(Uc>=0?1:-1);                        // 反り上げた縁が作る、機首上げのモーメント
      if(!e.ring) Mf-=rho*e.w*c*c*c*c/32*Math.abs(w[2])*w[2];     // 板そのものが回るときの抵抗（弦の前後が逆向きに空気を押す）
    }else{ const s=Math.sin(al); CN=.22*s*Math.cos(al)+1.6*s*Math.abs(s); fcp=.5; }
    const cd=e.k?1.5*cf:1.5*cf+.008, fn=q*CN+q*cd*Un/V, fc=q*cd*Uc/V;   // 板に垂直な力と、板に沿う摩擦
    const fx=fn*n[0]-fc, fy=fn*n[1], fz=fn*n[2];
    const rx=e.k?lx:lx-c*fcp;
    Fx+=fx; Fy+=fy; Fz+=fz;
    Mx+=ly*fz-lz*fy; My+=lz*fx-rx*fz; Mz+=rx*fy-ly*fx+Mf;
  }
  out.F[0]=Fx; out.F[1]=Fy; out.F[2]=Fz; out.M[0]=Mx; out.M[1]=My; out.M[2]=Mz; return out;
}

/* ---------- 設計の診断（まっすぐ滑空したときの釣り合い） ---------- */
function analyze(pl,env){
  const o={F:[0,0,0],M:[0,0,0]}, W=pl.m*env.g, res={m:pl.m,S:pl.S,b:pl.b,AR:pl.AR,mac:pl.mac,cgPct:pl.cgPct,load:pl.m/pl.S,kind:pl.kind};
  if(env.rho<1e-6){ res.state='vacuum'; res.sm=0; return res; }                    // 空気がなければ、翼は何もしない
  if(pl.kind==='ball'){ res.state='ball'; res.vterm=Math.sqrt(W/(.5*env.rho*pl.S*pl.CD)); return res; }
  const V0=5, rows=[];
  for(let d=-4;d<=40;d+=.25){ const a=d*Math.PI/180; aero(pl,[V0*Math.cos(a),-V0*Math.sin(a),0],[0,0,0],o,env);
    const L=o.F[0]*Math.sin(a)+o.F[1]*Math.cos(a), D=-(o.F[0]*Math.cos(a)-o.F[1]*Math.sin(a)); rows.push([d,o.M[2],L,D]); }
  res.rows=rows;
  const r0=rows.find(r=>r[0]===2), r1=rows.find(r=>r[0]===5);      // 中立点：ここより重心が前なら、機首を戻す力がはたらく
  res.sm=-((r1[1]-r0[1])/(r1[2]-r0[2]))/pl.mac*100;
  if(pl.kind==='ring'){ res.state=res.sm>0?'ring':'ringbad'; return res; }
  let trim=null;
  for(let i=1;i<rows.length;i++){ const a=rows[i-1], b=rows[i]; if(a[1]>0&&b[1]<=0&&b[0]>0.6){ const t=a[1]/(a[1]-b[1]);
      trim={alpha:a[0]+(b[0]-a[0])*t,L:a[2]+(b[2]-a[2])*t,D:a[3]+(b[3]-a[3])*t}; break; } }
  if(trim&&trim.L>0){ const R=Math.hypot(trim.L,trim.D), V=V0*Math.sqrt(W/R); res.zerog=W<1e-9;
    Object.assign(res,{trim:trim.alpha,LD:trim.L/trim.D,V,sink:V*trim.D/R,CL:trim.L/(.5*env.rho*V0*V0*pl.S)});
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
function launch(speed,angDeg,height,o){ o=o||{};
  const g=angDeg*Math.PI/180, q=[Math.cos(g/2),0,0,Math.sin(g/2)];
  if(o.roll){ const c=Math.cos(o.roll/2), s=Math.sin(o.roll/2), a=q.slice(); q[0]=a[0]*c; q[1]=a[0]*s; q[2]=a[3]*s; q[3]=a[3]*c; }
  return {p:[0,height,0],v:[speed*Math.cos(g),speed*Math.sin(g),0],q,w:[(o.spin||0)*2*Math.PI,o.yaw||0,0],t:0,alpha:0,speed,hmax:height,landed:false,path:[]};
}
const _vb=[0,0,0], _o={F:[0,0,0],M:[0,0,0]}, _fw=[0,0,0], _rel=[0,0,0], _wd=[0,0,0];
function step(st,pl,dt,env){
  const q=st.q, w=st.w, I=pl.I, Ii=pl.Iinv, wm=Math.hypot(pl.kind==='ring'?0:w[0],w[1],w[2]);   // 円筒は軸まわりの回転を数えない
  const nsub=pl.kind==='ball'?1:Math.min(10,1+Math.floor(wm/15)), h=dt/nsub;      // 速く回っているときは、刻みを細かくする
  for(let s=0;s<nsub;s++){
    if(env.calm){ _rel[0]=st.v[0]; _rel[1]=st.v[1]; _rel[2]=st.v[2]; } else { env.windAt(st.p,st.t,_wd); _rel[0]=st.v[0]-_wd[0]; _rel[1]=st.v[1]-_wd[1]; _rel[2]=st.v[2]-_wd[2]; }
    qinv(q,_rel,_vb); aero(pl,_vb,w,_o,env); qrot(q,_o.F,_fw);
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
function presets(paper){ const w=paper.pw;
  return [
    {id:'dart',name:'やり型',note:'角を2回、中心線へ折る。細くて速い',folds:[[[w,0],[0,w]],[[w,w],[0,w*Math.SQRT2]]],prm:{h:Math.round(w*.15),dih:8,elev:2.5,clips:0}},
    {id:'heso',name:'へそ型',note:'先を折り返して、機首を重くする。ゆっくり安定',folds:[[[w,0],[0,w]],[[0,0],[0,2*w]],[[w,w],[0,2*w]]],prm:{h:Math.round(w*.14),dih:10,elev:4,clips:0}},
  ]; }
function applyFolds(paper,list){ let f=newPaper(paper); for(const [A,B] of list){ const r=fold(f,A,B); if(r.err) throw new Error('fold '+r.err); f=r.faces; } return f; }
const toPrm=o=>({h:o.h,dih:o.dih*Math.PI/180,elev:o.elev*Math.PI/180,e:o.e||22,clips:o.clips||0,clipV:o.clipV||25});

root.KH={G,MATERIALS,SIZES,makePaper,air,makeEnv,newPaper,fold,clipHalf,area,bounds,spanAt,inside,buildPlane,buildRing,buildBall,aero,analyze,launch,step,fly,qrot,qinv,presets,applyFolds,toPrm,mapper};
})(typeof window!=='undefined'?window:globalThis);
