(() => {
  'use strict';
  const canvas = document.getElementById('sculpture');
  const scene = canvas.parentElement;
  const chapters = [...document.querySelectorAll('.chapter')];
  const links = [...document.querySelectorAll('.chapter-nav a')];
  const progressBar = document.getElementById('progress');
  const formNumber = document.getElementById('form-number');
  const motionButton = document.getElementById('motion-toggle');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false, userMotion = true, visible = true, targetScroll = 0, scroll = 0, pointerX = 0, pointerY = 0, px = 0, py = 0;
  // Retain the visitor's explicit choice, including reduced-motion opt-in.
  try { const preference=localStorage.getItem('lenkov-motion'); if(preference!==null){paused=preference==='paused';userMotion=!paused;} } catch {}
  const reduceMotion = () => reduced.matches && !userMotion;
  let offsets = [], lastTime = 0, time = 0, frame = 0, gl, program, uniforms, lost = false, dirty = true;
  let cursorActive=0, cursorLight=0;
  let pulse = 0, pulseX = .5, pulseY = .5, scrollEnergy = 0;
  const revealItems = [];
  const root = document.documentElement;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  document.getElementById('year').textContent = new Date().getFullYear();
  function measure() { offsets = chapters.map(el => el.offsetTop); updateScroll(); resize(); }
  function updateScroll() {
    dirty = true;
    const y = window.scrollY;
    let index = 0;
    while (index < offsets.length - 2 && y >= offsets[index + 1]) index++;
    targetScroll = Math.min(3, Math.max(0, index + (y - offsets[index]) / Math.max(1, offsets[index + 1] - offsets[index])));
    const current = Math.min(3, Math.floor(targetScroll + .45));
    links.forEach((link, i) => i === current ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current'));
    formNumber.textContent = String(current + 1).padStart(3, '0');
    progressBar.style.transform = `scaleX(${Math.min(1, y / Math.max(1, document.documentElement.scrollHeight - window.innerHeight))})`;
  }
  function syncMotionButton() {
    root.classList.toggle('motion-active', !paused && !reduceMotion());
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', window.siteCopy ? window.siteCopy(paused?'resumeAria':'pauseAria') : (paused?'Resume automatic motion':'Pause automatic motion'));
    document.getElementById('motion-label').textContent = window.siteCopy ? window.siteCopy(paused?'resume':'pause') : (paused?'Resume motion':'Pause motion');
    motionButton.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
  }
  syncMotionButton();
  document.addEventListener('languagechange',()=>{syncMotionButton();measure();});
  motionButton.addEventListener('click', () => {
    paused = !paused;
    userMotion = !paused;
    try {localStorage.setItem('lenkov-motion',paused?'paused':'active');} catch {}
    dirty = true;
    syncMotionButton();
  });
  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('pointermove', e => { if(e.pointerType !== 'touch') { cursorActive=1; pointerX = e.clientX / innerWidth * 2 - 1; pointerY = e.clientY / innerHeight * 2 - 1; } }, {passive:true});
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; lastTime = 0; });
  window.addEventListener('pointerdown', e => {
    if (paused || reduceMotion() || e.target.closest('a,button,input')) return;
    pulse=1; pulseX=e.clientX/innerWidth; pulseY=1-e.clientY/innerHeight; dirty=true;
  }, {passive:true});
  document.addEventListener('pointerleave', () => {pointerX=0;pointerY=0;cursorActive=0;dirty=true;});
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      entry.target.classList.toggle('in-view',entry.isIntersecting);
    }),{threshold:.12,rootMargin:'0px 0px -55px 0px'});
    document.querySelectorAll('.chapter-copy > *, .practice-content > .eyebrow, .practice-content > h2, .practice-list article, .tool-deck, .contact-content > *').forEach((el,i)=>{
      el.classList.add('reveal-item');el.style.setProperty('--reveal-delay',`${(i%4)*80}ms`);observer.observe(el);revealItems.push(el);
    });
  }
  document.querySelectorAll('.email-button,.contact-link').forEach(el=>{
    el.addEventListener('pointermove',e=>{if(paused||reduceMotion()||e.pointerType==='touch')return;const r=el.getBoundingClientRect();el.style.setProperty('--magnet-x',`${(e.clientX-r.left-r.width/2)*.13}px`);el.style.setProperty('--magnet-y',`${(e.clientY-r.top-r.height/2)*.2}px`);});
    el.addEventListener('pointerleave',()=>{el.style.setProperty('--magnet-x','0px');el.style.setProperty('--magnet-y','0px');});
  });
  document.querySelectorAll('.email-button,.fine-rule').forEach(el=>{
    el.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch')return;
      const r=el.getBoundingClientRect();
      el.style.setProperty('--light-x',`${e.clientX-r.left}px`);
      el.style.setProperty('--light-y',`${e.clientY-r.top}px`);
      el.classList.add('cursor-lit');
    });
    el.addEventListener('pointerleave',()=>el.classList.remove('cursor-lit'));
  });
  const vertex = `attribute vec2 position; varying vec2 uv; void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`;
  const fragment = `
    precision highp float;
    varying vec2 uv;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float clock;
    uniform float chapter;
    uniform float mobile;
    uniform float energy;
    uniform float cursorLight;
    uniform vec3 ripple;
    mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    float cursorGlow(){
      vec2 cursorUV=vec2(pointer.x*.5+.5,.5-pointer.y*.5);
      vec2 delta=(uv-cursorUV)*vec2(resolution.x/resolution.y,1.);
      return exp(-dot(delta,delta)*32.)*cursorLight;
    }
    float map(vec3 p){
      float a=smoothstep(0.,1.,chapter),b=smoothstep(1.,2.,chapter),c=smoothstep(2.,3.,chapter);
      // Keep the opening readable in every chapter instead of turning edge-on.
      p.xy=rot(.18+chapter*.38+clock*.045+sin(clock*.27)*.09)*p.xy;
      p.xz=rot(.28+.24*sin(chapter*1.25)+sin(clock*.23)*.16+pointer.x*.14)*p.xz;
      p.yz=rot(-.18+.15*sin(clock*.29)+pointer.y*.1)*p.yz;
      float stretch=1.06+.05*a-.04*b+.018*sin(clock*.38);
      p.x/=stretch;p.y*=stretch;
      float angle=atan(p.y,p.x);
      // A closed, softly folded band: an asymmetric spine and an elliptical section.
      // All angular terms are periodic; the half-turn section is identical at the seam.
      float radius=.77+.075*cos(2.*angle-.65)+.035*sin(3.*angle+.4);
      radius+=.012*sin(clock*.45)*cos(2.*angle);
      float rise=.20*sin(2.*angle+.3)+.055*cos(angle-.4);
      rise+=.02*sin(clock*.4)*sin(angle);
      vec2 section=vec2(length(p.xy)-radius,p.z-rise);
      float twist=angle*.5+.32*sin(angle)+.22+.08*sin(clock*.32)+.08*a-.06*c;
      section=rot(twist)*section;
      float width=.25+.035*cos(angle-.6)+.01*sin(clock*.5);
      float depth=.09+.008*sin(angle+.5);
      // Underestimate distance after the warp so rays cannot skip the surface.
      return (length(section/vec2(width,depth))-1.)*depth/1.8;
    }
    vec3 normal(vec3 p){vec2 e=vec2(.001,-.001);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}
    vec3 environment(vec3 d){
      d.xz=rot(.12*sin(clock*.18))*d.xz;
      vec3 col=vec3(.055,.07,.10);
      // Stable studio softboxes reveal the fold with long, feathered highlights.
      col+=vec3(.7,.77,.9)*pow(max(0.,dot(d,normalize(vec3(-.55,.75,1.)))),7.);
      col+=vec3(.28,.4,.62)*pow(max(0.,dot(d,normalize(vec3(.8,.1,-.5)))),9.);
      col+=vec3(.32,.27,.24)*pow(max(0.,dot(d,normalize(vec3(-.3,-.7,.55)))),6.);
      col+=vec3(.65,.73,.86)*smoothstep(.62,.98,d.y);
      float strip=exp(-pow((d.x+.3)/.14,2.))*smoothstep(-.5,.6,d.y);
      col+=vec3(.62,.7,.84)*strip;
      return col;
    }
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    vec3 background(vec2 p){
      float halo=exp(-length(p*vec2(1.,1.15))*2.8);
      vec3 col=mix(vec3(.025,.029,.038),vec3(.068,.082,.109),halo);
      float light=cursorGlow();col+=vec3(.022,.04,.075)*light;
      // Three depths of drifting particles; entirely procedural, no asset downloads.
      for(int layer=0;layer<3;layer++){
        float depth=float(layer),scale=12.+depth*7.;
        vec2 dust=uv*vec2(resolution.x/resolution.y,1.)*scale;
        dust+=vec2(clock*(.11+depth*.055),clock*(.17+depth*.06))+pointer*(.1+depth*.08);
        vec2 cell=floor(dust),f=fract(dust);float seed=hash(cell+depth*13.);
        vec2 center=vec2(.25+seed*.5,.25+hash(cell+4.)*.5);
        center+=.13*vec2(sin(clock*.7+seed*30.),cos(clock*.6+seed*21.));
        float distanceToStar=length(f-center);
        float star=1.-smoothstep(.012,.052-depth*.009,distanceToStar);
        float glow=exp(-distanceToStar*24.)*.16;
        col+=vec3(.36,.5,.75)*(star+glow)*(1.+light*3.5)*step(.78,seed)*(.7+.3*sin(clock*1.2+seed*20.))/(1.+depth*.4);
      }
      // Flowing orbital filaments with moving luminous beads and comet-like tails.
      for(int orbit=0;orbit<3;orbit++){
        float index=float(orbit);
        vec2 q=rot(.3+index*.9+sin(clock*.22+index)*.2)*p;
        q.y*=1.3+index*.25;
        float angle=atan(q.y,q.x),radius=.48+index*.085;
        radius+=.018*sin(angle*3.+clock*.7+index);
        float distanceToLine=abs(length(q)-radius);
        float phase=angle-clock*(.55+index*.18)+index*2.;
        float sweep=pow(.5+.5*cos(phase),16.);
        float thread=exp(-distanceToLine*650.);
        float glow=exp(-distanceToLine*95.);
        float beads=pow(max(0.,cos(phase*12.)),40.);
        col+=vec3(.18,.31,.52)*(thread*(.14+sweep*.9)+glow*sweep*.2)*(1.+light*1.5);
        col+=vec3(.55,.72,1.)*beads*exp(-distanceToLine*350.)*(.25+sweep*.6);
      }
      float wave=abs(length((uv-ripple.xy)*vec2(resolution.x/resolution.y,1.))-(1.-ripple.z)*1.3);
      col+=vec3(.075,.11,.17)*exp(-wave*100.)*ripple.z;
      return col;
    }
    void main(){
      vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
      float a=smoothstep(0.,1.,chapter),b=smoothstep(1.,2.,chapter),c=smoothstep(2.,3.,chapter);
      float x=mix(0.,.54,a);x=mix(x,-.59,b);x=mix(x,0.,c);
      float y=mix(.10,0.,a); y=mix(y,.10,b);y=mix(y,.23,c);
      x*=1.-mobile;y=mix(y,.27,mobile*(1.-c));
      p-=vec2(x+sin(clock*.2)*.013,y+sin(clock*.31)*.016);
      float camera=mix(3.8,3.5,a);camera=mix(camera,4.,b);camera=mix(camera,4.7,c);camera+=mobile*.9;
      vec3 ro=vec3(pointer.x*.045,-pointer.y*.035,camera),rd=normalize(vec3(p*2.05,-2.45));
      vec3 col=background(p);
      float boundB=dot(ro,rd),boundH=boundB*boundB-dot(ro,ro)+2.56;
      if(boundH>0.){
        float t=max(.01,-boundB-sqrt(boundH)),end=-boundB+sqrt(boundH);
        float edge=10.,closestT=t;bool hit=false;
        // Pixel-cone coverage smooths the silhouette, including rays that narrowly miss.
        float pixelCone=1.15/resolution.y;
        for(int i=0;i<160;i++){
          float d=map(ro+rd*t),coverage=d/max(.0001,t*pixelCone);
          if(coverage<edge){edge=coverage;closestT=t;}
          if(d<.00035){hit=true;closestT=t;break;}
          t+=max(d*.72,.0002);if(t>end)break;
        }
        if(hit||edge<1.){
          vec3 pos=ro+rd*closestT,n=normal(pos),r=reflect(rd,n);
          float fres=pow(1.-max(0.,dot(-rd,n)),4.);
          float ao=clamp(map(pos+n*.14)*1.8/.14,.5,1.);
          vec3 metal=environment(r)*(.68+.32*ao);
          vec3 cursorDirection=normalize(vec3(pointer.x*1.8,-pointer.y*1.8,2.5)-pos);
          float cursorDiffuse=max(0.,dot(n,cursorDirection));
          float cursorSpec=pow(max(0.,dot(n,normalize(cursorDirection-rd))),18.);
          metal+=vec3(.28,.42,.67)*(cursorDiffuse*.28+cursorSpec*.65)*cursorGlow();
          float diffuse=max(0.,dot(n,normalize(vec3(-.5,.9,1.))));
          metal+=vec3(.10,.12,.16)*diffuse+fres*vec3(.15,.22,.34);
          vec3 iridescence=.5+.5*cos(6.28318*(dot(n,-rd)*1.5+vec3(0.,.12,.25))+chapter*.5);
          metal*=mix(vec3(1.),vec3(iridescence),.12*fres);
          metal=pow(metal/(.65+metal),vec3(.87));
          float coverage=hit?1.:1.-smoothstep(.0,1.,edge);
          col=mix(col,metal,coverage);
        }
      }
      float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
      col+=grain*.003;
      gl_FragColor=vec4(col,1.);
    }
  `;
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) { const message=gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(message); }
    return s;
  }
  function init() {
    gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,powerPreference:'high-performance'});
    if(!gl) return;
    program=gl.createProgram();const v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    uniforms=Object.fromEntries(['resolution','pointer','clock','chapter','mobile','energy','ripple','cursorLight'].map(key=>[key,gl.getUniformLocation(program,key)]));
    resize();scene.classList.add('ready');lost=false;
  }
  function resize() { dirty=true;if(!gl || !program) return;const cap=innerWidth<700?1400000:2800000;const ratio=Math.min(Math.max(devicePixelRatio||1,1.25),2,Math.sqrt(cap/(innerWidth*innerHeight)));canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);gl.viewport(0,0,canvas.width,canvas.height); }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;scene.classList.remove('ready');});
  canvas.addEventListener('webglcontextrestored',()=>{try{init();}catch{scene.classList.remove('ready');}});
  function draw(now){
    frame=requestAnimationFrame(draw);
    if(!visible || lost) return;
    const dt=Math.min(.05, lastTime?(now-lastTime)/1000:.016);lastTime=now;
    const quiet=reduceMotion();
    const lightTarget=quiet||paused?0:cursorActive;
    if(Math.abs(lightTarget-cursorLight)>.001)dirty=true;
    cursorLight+=(lightTarget-cursorLight)*(1-Math.exp(-dt*8));
    const moving=Math.abs(targetScroll-scroll)>.0001 || Math.abs((quiet?0:pointerX)-px)>.0001 || Math.abs((quiet?0:pointerY)-py)>.0001;
    if((paused || quiet) && !moving && !dirty) return;
    if(!paused && !quiet)time+=dt;
    if(!paused && !quiet)pulse=Math.max(0,pulse-dt*.65);
    scrollEnergy+=(clamp((targetScroll-scroll)*2,-1,1)-scrollEnergy)*(1-Math.exp(-dt*5));
    const follow=1-Math.exp(-dt*7);
    scroll=quiet?targetScroll:scroll+(targetScroll-scroll)*follow;
    px+=((quiet?0:pointerX)-px)*follow;py+=((quiet?0:pointerY)-py)*follow;
    if(!gl || !program) return;
    gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.uniform2f(uniforms.pointer,px,py);gl.uniform1f(uniforms.clock,time);gl.uniform1f(uniforms.chapter,scroll);gl.uniform1f(uniforms.mobile,innerWidth<600?1:0);gl.uniform1f(uniforms.energy,scrollEnergy);gl.uniform1f(uniforms.cursorLight,cursorLight);gl.uniform3f(uniforms.ripple,pulseX,pulseY,pulse);gl.drawArrays(gl.TRIANGLES,0,6);dirty=false;
  }
  try{init();}catch(error){console.warn('3D unavailable; showing static artwork.',error);gl=null;program=null;scene.classList.remove('ready');}
  measure();scroll=targetScroll;frame=requestAnimationFrame(draw);
  window.addEventListener('pagehide',()=>cancelAnimationFrame(frame));
  window.addEventListener('pageshow',event=>{if(event.persisted){lastTime=0;frame=requestAnimationFrame(draw);}});
})();
