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
    float noiseHash(vec3 p){
      p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;
      return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
    }
    float noise3(vec3 p){
      vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(noiseHash(i),noiseHash(i+vec3(1,0,0)),f.x),
                     mix(noiseHash(i+vec3(0,1,0)),noiseHash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(noiseHash(i+vec3(0,0,1)),noiseHash(i+vec3(1,0,1)),f.x),
                     mix(noiseHash(i+vec3(0,1,1)),noiseHash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float clouds(vec3 p){
      float value=0.,amplitude=.55;
      for(int octave=0;octave<4;octave++){
        value+=amplitude*noise3(p);p=p*2.03+vec3(7.1,3.7,1.8);amplitude*=.48;
      }
      return value;
    }
    vec3 planetSurface(vec3 n,vec3 rd){
      // Rotate a seamless three-dimensional cloud field on a true sphere.
      vec3 q=n;q.xy=rot(-.38+pointer.y*.06)*q.xy;
      q.xz=rot(clock*.075+chapter*.3+pointer.x*.12)*q.xz;
      float flow=clouds(q*3.1+vec3(0.,clock*.008,0.));
      float bands=.5+.5*sin(q.y*21.+flow*4.+sin(q.x*3.)*.6);
      float mist=clouds(q*7.5+flow*1.4);
      vec3 albedo=mix(vec3(.16,.23,.32),vec3(.34,.43,.54),smoothstep(.1,.9,bands));
      albedo=mix(albedo,vec3(.56,.62,.69),smoothstep(.48,.75,mist)*.24);
      vec3 light=normalize(vec3(-.7,.85,1.1));
      float sun=max(0.,dot(n,light));
      float rim=pow(1.-max(0.,dot(n,-rd)),3.5);
      float spec=pow(max(0.,dot(n,normalize(light-rd))),34.);
      vec3 color=albedo*(.13+.95*sun)+vec3(.32,.39,.48)*spec*.32;
      color+=vec3(.12,.25,.43)*rim*(.3+.7*sun);
      vec3 cursorDirection=normalize(vec3(pointer.x*1.8,-pointer.y*1.8,2.5)-n*.93);
      color+=vec3(.12,.21,.34)*pow(max(0.,dot(n,cursorDirection)),4.)*cursorGlow();
      return pow(color,vec3(.82));
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
      x*=1.-mobile;y=mix(y,.22,mobile*(1.-c));
      p-=vec2(x+sin(clock*.2)*.013,y+sin(clock*.31)*.016);
      float camera=mix(3.8,3.5,a);camera=mix(camera,4.,b);camera=mix(camera,4.7,c);
      camera=mix(camera,max(camera+.9,resolution.y/resolution.x*3.1),mobile);
      vec3 ro=vec3(pointer.x*.045,-pointer.y*.035,camera),rd=normalize(vec3(p*2.05,-2.45));
      vec3 col=background(p);
      // Analytic sphere intersection: a round silhouette without marching artifacts.
      float radius=.93;
      float rayB=dot(ro,rd),h=rayB*rayB-dot(ro,ro)+radius*radius;
      float closest=max(0.,-rayB);
      float miss=length(ro+rd*closest)-radius;
      float pixel=max(.0001,closest*.84/resolution.y);
      float atmosphere=exp(-max(0.,miss)*26.)*(1.-smoothstep(.0,.32,miss));
      col+=vec3(.055,.13,.24)*atmosphere;
      if(miss<pixel){
        float t=-rayB-sqrt(max(0.,h));
        vec3 n=normalize(ro+rd*t);
        vec3 surface=planetSurface(n,rd);
        float coverage=1.-smoothstep(-pixel,pixel,miss);
        col=mix(col,surface,coverage);
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
