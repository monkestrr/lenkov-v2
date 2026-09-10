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
  let paused = reduced.matches, userMotion = false, visible = true, targetScroll = 0, scroll = 0, pointerX = 0, pointerY = 0, px = 0, py = 0;
  const reduceMotion = () => reduced.matches && !userMotion;
  let offsets = [], lastTime = 0, time = 0, frame = 0, gl, program, uniforms, lost = false, dirty = true;
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
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? 'Resume automatic motion' : 'Pause automatic motion');
    document.getElementById('motion-label').textContent = paused ? 'Resume motion' : 'Pause motion';
    motionButton.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
  }
  syncMotionButton();
  motionButton.addEventListener('click', () => {
    paused = !paused;
    userMotion = !paused;
    dirty = true;
    syncMotionButton();
  });
  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('pointermove', e => { if(e.pointerType !== 'touch') { pointerX = e.clientX / innerWidth * 2 - 1; pointerY = e.clientY / innerHeight * 2 - 1; } }, {passive:true});
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; lastTime = 0; });
  const vertex = `attribute vec2 position; varying vec2 uv; void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`;
  const fragment = `
    precision highp float;
    varying vec2 uv;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float clock;
    uniform float chapter;
    uniform float mobile;
    mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    float torus(vec3 p,float r,float t){return length(vec2(length(p.xy)-r,p.z))-t;}
    float smoothMin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
    float map(vec3 p){
      float a=smoothstep(0.,1.,chapter),b=smoothstep(1.,2.,chapter),c=smoothstep(2.,3.,chapter);
      p.xy=rot(.3+chapter*.55+sin(clock*.12)*.08)*p.xy;
      p.xz=rot(.5+chapter*.48+pointer.x*.13)*p.xz;
      p.yz=rot(.18+sin(clock*.17)*.14+pointer.y*.09)*p.yz;
      float radius=.91-.12*a+.2*b-.12*c;
      float thickness=.195+.065*a-.04*b;
      vec3 q=p; q.z-=.19*sin(atan(p.y,p.x)*3.+clock*.15)*(1.-a*.65);
      float first=torus(q,radius,thickness);
      vec3 q2=p; q2.xz=rot(.62+a*.68+b*.45)*q2.xz;q2.yz=rot(.5+b*.6)*q2.yz;
      float second=torus(q2,radius-.05,thickness*.62)-.01;
      float blend=smoothMin(first,second,.08);
      float result=mix(first,blend,smoothstep(.1,.9,chapter));
      vec3 q3=p; q3.yz=rot(1.5708)*q3.yz;q3.xz=rot(-.4)*q3.xz;
      float third=torus(q3,.67,.10);
      result=mix(result,smoothMin(result,third,.07),b*(1.-c*.7));
      return result;
    }
    vec3 normal(vec3 p){vec2 e=vec2(.0012,0.);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
    vec3 environment(vec3 d){
      vec3 col=vec3(.07,.09,.14);
      float strip=pow(max(0.,1.-abs(dot(d,normalize(vec3(.4,.7,.55))))),20.);
      col+=vec3(.48,.59,.82)*strip*1.35;
      col+=vec3(1.1,1.14,1.2)*pow(max(0.,dot(d,normalize(vec3(-.7,.65,1.)))),9.);
      col+=vec3(.65,.75,1.)*pow(max(0.,dot(d,normalize(vec3(.8,.15,-.6)))),18.);
      col+=vec3(.68,.49,.32)*pow(max(0.,dot(d,normalize(vec3(-.2,-.65,.6)))),32.)*.5;
      col+=vec3(1.7)*smoothstep(.955,.98,d.y);
      return col;
    }
    void main(){
      vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
      float a=smoothstep(0.,1.,chapter),b=smoothstep(1.,2.,chapter),c=smoothstep(2.,3.,chapter);
      float x=mix(0.,.54,a);x=mix(x,-.59,b);x=mix(x,0.,c);
      float y=mix(.10,0.,a); y=mix(y,.10,b);y=mix(y,.23,c);
      x*=1.-mobile;y=mix(y,.27,mobile*(1.-c));
      p-=vec2(x,y);
      float camera=mix(3.8,3.5,a);camera=mix(camera,4.,b);camera=mix(camera,4.7,c);camera+=mobile*.9;
      vec3 ro=vec3(pointer.x*.045,-pointer.y*.035,camera),rd=normalize(vec3(p*2.05,-2.45));
      float halo=exp(-length(p*vec2(1.,1.15))*2.8);
      vec3 col=mix(vec3(.031,.035,.044),vec3(.079,.091,.116),halo);
      float t=0.; bool hit=false;
      for(int i=0;i<78;i++){float d=map(ro+rd*t);if(d<.0015){hit=true;break;}t+=d*.82;if(t>8.)break;}
      if(hit){vec3 pos=ro+rd*t;vec3 n=normal(pos);vec3 r=reflect(rd,n);float fres=pow(1.-max(0.,dot(-rd,n)),4.);float ao=clamp(map(pos+n*.13)/.13,.15,1.);vec3 metal=environment(r);float diffuse=max(0.,dot(n,normalize(vec3(-.5,.9,1.))));col=metal*(.7+.3*ao)+vec3(.10,.12,.16)*diffuse;col+=fres*vec3(.18,.24,.36);col*=.84+.16*ao;col=col/(.65+col);col=pow(col,vec3(.87));}
      float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
      col+=grain*.008;
      gl_FragColor=vec4(col,1.);
    }
  `;
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) { const message=gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(message); }
    return s;
  }
  function init() {
    gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,powerPreference:'low-power'});
    if(!gl) return;
    program=gl.createProgram();const v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    uniforms=Object.fromEntries(['resolution','pointer','clock','chapter','mobile'].map(key=>[key,gl.getUniformLocation(program,key)]));
    resize();scene.classList.add('ready');lost=false;
  }
  function resize() { dirty=true;if(!gl || !program) return;const cap=innerWidth<700?520000:1100000;const ratio=Math.min(devicePixelRatio||1,1.4,Math.sqrt(cap/(innerWidth*innerHeight)));canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);gl.viewport(0,0,canvas.width,canvas.height); }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;scene.classList.remove('ready');});
  canvas.addEventListener('webglcontextrestored',()=>{try{init();}catch{scene.classList.remove('ready');}});
  function draw(now){
    frame=requestAnimationFrame(draw);
    if(!visible || lost) return;
    const dt=Math.min(.05, lastTime?(now-lastTime)/1000:.016);lastTime=now;
    const quiet=reduceMotion();
    const moving=Math.abs(targetScroll-scroll)>.0001 || Math.abs((quiet?0:pointerX)-px)>.0001 || Math.abs((quiet?0:pointerY)-py)>.0001;
    if((paused || quiet) && !moving && !dirty) return;
    if(!paused && !quiet)time+=dt;
    const follow=1-Math.exp(-dt*7);
    scroll=quiet?targetScroll:scroll+(targetScroll-scroll)*follow;
    px+=((quiet?0:pointerX)-px)*follow;py+=((quiet?0:pointerY)-py)*follow;
    if(!gl || !program) return;
    gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.uniform2f(uniforms.pointer,px,py);gl.uniform1f(uniforms.clock,time);gl.uniform1f(uniforms.chapter,scroll);gl.uniform1f(uniforms.mobile,innerWidth<600?1:0);gl.drawArrays(gl.TRIANGLES,0,6);dirty=false;
  }
  try{init();}catch(error){console.warn('3D unavailable; showing static artwork.',error);gl=null;program=null;scene.classList.remove('ready');}
  measure();scroll=targetScroll;frame=requestAnimationFrame(draw);
  window.addEventListener('pagehide',()=>cancelAnimationFrame(frame));
  window.addEventListener('pageshow',event=>{if(event.persisted){lastTime=0;frame=requestAnimationFrame(draw);}});
})();
