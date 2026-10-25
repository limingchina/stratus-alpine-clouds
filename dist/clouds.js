import { multiply, inverse, localFrame } from './math.js';
import { advanceWind } from './wind.js';

const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const cloudFragment = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 color;
uniform sampler3D u_noise;
uniform highp sampler2D u_depth;
uniform mat4 u_inverse;
uniform vec3 u_eye, u_sun;
uniform vec2 u_depthRange, u_windOffset;
uniform float u_coverage, u_base, u_thickness, u_warmth;
uniform int u_steps;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float valueNoise(vec3 p) {
  // Apply the Hermite curve before the hardware trilinear interpolation.
  vec3 cell = floor(p), f = fract(p);
  return textureLod(u_noise, (cell + f*f*(3.0-2.0*f) + 0.5)/64.0, 0.0).r;
}
float shape(vec3 p, bool detailed) {
  float h = (p.z - u_base) / u_thickness;
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 advected = p - vec3(u_windOffset, 0.0);
  vec3 q = advected / vec3(1900.0,1900.0,1150.0);
  q += 0.18*sin(q.yzx*1.6);
  float n = valueNoise(q)*0.57 + valueNoise(q*2.03+13.7)*0.28;
  n += valueNoise(q*4.07+27.1)*0.15;
  float billow = textureLod(u_noise, advected/15000.0, 0.0).g;
  n = n*0.78 + billow*0.22;
  float profile = smoothstep(0.0,0.12,h)*(1.0-smoothstep(0.38,1.0,h));
  float threshold = mix(0.79,0.27,u_coverage) + (1.0-profile)*0.22;
  float density = max(0.0, (n-threshold)*3.7);
  if (detailed && density > 0.0) {
    float erosion = textureLod(u_noise,advected/2300.0,0.0).g;
    density = max(0.0,density-(1.0-erosion)*0.15*(1.0-density));
  }
  return clamp(density,0.0,1.0)*profile;
}
vec3 unproject(vec2 at, float depth) {
  vec4 world = u_inverse*vec4(at*2.0-1.0,depth*2.0-1.0,1.0);
  return world.xyz/world.w;
}
float illumination(vec3 p) {
  // Four increasingly spaced samples approximate the optical depth to the sun.
  float optical = shape(p+u_sun*110.0,false)*160.0;
  optical += shape(p+u_sun*330.0,false)*270.0;
  optical += shape(p+u_sun*760.0,false)*470.0;
  optical += shape(p+u_sun*1450.0,false)*730.0;
  return exp(-optical*0.0022);
}
void main() {
  if (u_coverage <= 0.001) { color=vec4(0.0); return; }
  vec3 ray=normalize(unproject(uv,0.0)-u_eye);
  float rawDepth=texture(u_depth,uv).r;
  // MapLibre reserves depth slices for 2D layers. Undo depthRange before
  // interpreting the terrain's window-space depth as projection NDC.
  float depth=clamp((rawDepth-u_depthRange.x)/(u_depthRange.y-u_depthRange.x),0.0,1.0);
  float surface=rawDepth<0.9999999 ? length(unproject(uv,depth)-u_eye) : 85000.0;
  float start=0.0, end=min(surface,85000.0);
  if (abs(ray.z)>0.00001) {
    vec2 hit=(vec2(u_base,u_base+u_thickness)-u_eye.z)/ray.z;
    start=max(start,min(hit.x,hit.y));
    end=min(end,max(hit.x,hit.y));
  } else if(u_eye.z<u_base || u_eye.z>u_base+u_thickness) {
    color=vec4(0.0); return;
  }
  if (start>=end) { color=vec4(0.0); return; }
  float dt=(end-start)/float(u_steps);
  float t=start+dt*hash(floor(gl_FragCoord.xy));
  vec4 sum=vec4(0.0);
  float mu=dot(ray,u_sun), g=0.45;
  float phase=(1.0-g*g)/pow(max(0.15,1.0+g*g-2.0*g*mu),1.5);
  vec3 sunlight=mix(vec3(1.0,0.99,0.94),vec3(1.0,0.69,0.39),u_warmth);
  vec3 ambient=mix(vec3(0.52,0.65,0.76),vec3(0.56,0.55,0.64),u_warmth);
  for(int i=0;i<96;i++) {
    if(i>=u_steps || sum.a>0.995 || t>=end) break;
    vec3 p=u_eye+ray*t;
    float den=shape(p,true);
    if(den>0.003) {
      float light=illumination(p);
      float powder=1.0-exp(-den*5.0);
      vec3 scattering=ambient*(0.70+0.20*powder);
      scattering+=sunlight*(0.23+0.85*light)*(0.78+0.17*phase);
      vec3 haze=mix(vec3(0.73,0.82,0.85),vec3(0.87,0.76,0.65),u_warmth);
      scattering=mix(scattering,haze,1.0-exp(-t*0.000016));
      float alpha=1.0-exp(-den*dt*0.0025);
      sum+=vec4(scattering*alpha,alpha)*(1.0-sum.a);
    }
    t+=dt;
  }
  color=sum;
}`;

const compositeFragment = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D u_cloud;
uniform highp sampler2D u_depth;
uniform vec2 u_cloudSize, u_nearFar, u_depthRange;
uniform mat4 u_inverse;
uniform vec3 u_eye;
uniform float u_warmth, u_enabled;
float linearDepth(float d) {
  d=clamp((d-u_depthRange.x)/(u_depthRange.y-u_depthRange.x),0.0,1.0);
  return 2.0*u_nearFar.x*u_nearFar.y/(u_nearFar.y+u_nearFar.x-(d*2.0-1.0)*(u_nearFar.y-u_nearFar.x));
}
void main() {
  float rawDepth=texture(u_depth,uv).r;
  float depth=clamp((rawDepth-u_depthRange.x)/(u_depthRange.y-u_depthRange.x),0.0,1.0);
  float centerDepth=linearDepth(rawDepth);
  vec2 grid=uv*u_cloudSize-0.5, f=fract(grid), p=floor(grid);
  vec4 clouds=vec4(0.0); float total=0.0;
  // Bilateral upsampling prevents low-resolution clouds bleeding over ridgelines.
  for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
    vec2 corner=vec2(float(x),float(y));
    vec2 at=(p+corner+0.5)/u_cloudSize;
    float d=linearDepth(texture(u_depth,at).r);
    float spatial=mix(1.0-f.x,f.x,float(x))*mix(1.0-f.y,f.y,float(y));
    float w=spatial*max(0.0001,exp(-abs(d-centerDepth)/max(1.0,centerDepth*0.012)));
    clouds+=texture(u_cloud,at)*w; total+=w;
  }
  clouds=clouds/max(total,0.0001)*u_enabled;
  vec4 world=u_inverse*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
  float distanceToGround=length(world.xyz/world.w-u_eye);
  float fog=rawDepth<0.9999999 ? clamp(1.0-exp(-distanceToGround*0.000014),0.0,0.7) : 0.0;
  vec3 fogColor=mix(vec3(0.68,0.78,0.82),vec3(0.85,0.71,0.57),u_warmth);
  color=clouds+vec4(fogColor*fog,fog)*(1.0-clouds.a);
}`;

function program(gl, fragment) {
  const shaders=[];
  const p=gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
    const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p,s); shaders.push(s);
  }
  gl.linkProgram(p);
  for(const s of shaders) gl.deleteShader(s);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const uniforms={};
  for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++) {
    const {name}=gl.getActiveUniform(p,i); uniforms[name]=gl.getUniformLocation(p,name);
  }
  return {p,u:uniforms};
}

// A repeatable, tileable 64³ texture: smooth value noise in R and cellular
// (Worley F1) billows in G. This replaces expensive per-step procedural hashes.
function noiseVolume() {
  const size=64, data=new Uint8Array(size*size*size*2);
  let seed=79341;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const points=Array.from({length:512},()=>[random(),random(),random()]);
  const wrap=n=>((n%8)+8)%8;
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const px=x/8,py=y/8,pz=z/8,ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);
    let nearest=9;
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
      const p=points[(wrap(iz+dz)*8+wrap(iy+dy))*8+wrap(ix+dx)];
      const a=ix+dx+p[0]-px,b=iy+dy+p[1]-py,c=iz+dz+p[2]-pz;
      nearest=Math.min(nearest,a*a+b*b+c*c);
    }
    const i=((z*size+y)*size+x)*2;
    data[i]=Math.floor(random()*256);
    data[i+1]=Math.round(Math.max(0,1-Math.sqrt(nearest)*0.8)*255);
  }
  return data;
}

export const qualityPresets={draft:{scale:0.30,steps:40},balanced:{scale:0.45,steps:64},high:{scale:0.65,steps:96}};

export class CloudLayer {
  id='volumetric-clouds'; type='custom'; renderingMode='3d';
  constructor(origin, settings, onStatus) {
    this.model=localFrame(origin); this.settings=settings; this.onStatus=onStatus;
    this.windOffset=[0,0]; this.last=0; this.frames=0; this.lastMetric=0; this.running=true; this.visible=true;
    this.resolutionScale=1;this.slowFrames=0;
  }
  onAdd(map,gl) {
    this.map=map; this.gl=gl;
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const previousNoise=gl.getParameter(gl.TEXTURE_BINDING_3D);
    try {
      this.cloud=program(gl,cloudFragment); this.composite=program(gl,compositeFragment);
      this.vao=gl.createVertexArray(); this.cloudFBO=gl.createFramebuffer(); this.depthFBO=gl.createFramebuffer();
      this.cloudTexture=gl.createTexture(); this.depthTexture=gl.createTexture();
      this.noiseTexture=gl.createTexture();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D,this.noiseTexture);
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,64,64,64,0,gl.RG,gl.UNSIGNED_BYTE,noiseVolume());
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D,wrap,gl.REPEAT);
      this.ready=true;
      this.onStatus({ready:true});
    } catch(error) { this.fail(error); }
    finally {gl.bindTexture(gl.TEXTURE_3D,previousNoise);gl.activeTexture(active);}
  }
  fail(error) {
    this.ready=false; console.error('Cloud renderer:',error);
    this.onStatus({error:error.message});
  }
  resize(gl,w,h,target) {
    const quality=qualityPresets[this.settings.quality];
    const scale=Math.min(quality.scale*this.resolutionScale,Math.sqrt(500000/(w*h)));
    const cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
    if(this.w===w&&this.h===h&&this.cw===cw&&this.ch===ch) return;
    this.w=w;this.h=h;this.cw=cw;this.ch=ch;
    gl.activeTexture(gl.TEXTURE0);
    // Match the source attachment exactly; DEPTH24_STENCIL8 is usual for MapLibre.
    const depthBits=gl.getParameter(gl.DEPTH_BITS),stencilBits=gl.getParameter(gl.STENCIL_BITS);
    let format=stencilBits>0
      ? (depthBits===32?gl.DEPTH32F_STENCIL8:gl.DEPTH24_STENCIL8)
      : (depthBits===32?gl.DEPTH_COMPONENT32F:depthBits===16?gl.DEPTH_COMPONENT16:gl.DEPTH_COMPONENT24);
    if(target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);
      const type=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
      if(type===gl.RENDERBUFFER) {
        const previous=gl.getParameter(gl.RENDERBUFFER_BINDING);
        gl.bindRenderbuffer(gl.RENDERBUFFER,gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME));
        format=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_INTERNAL_FORMAT);
        gl.bindRenderbuffer(gl.RENDERBUFFER,previous);
      }
    }
    const packed=format===gl.DEPTH24_STENCIL8||format===gl.DEPTH32F_STENCIL8;
    const type=format===gl.DEPTH_COMPONENT16?gl.UNSIGNED_SHORT:format===gl.DEPTH_COMPONENT32F?gl.FLOAT:format===gl.DEPTH32F_STENCIL8?gl.FLOAT_32_UNSIGNED_INT_24_8_REV:packed?gl.UNSIGNED_INT_24_8:gl.UNSIGNED_INT;
    gl.bindTexture(gl.TEXTURE_2D,this.depthTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,format,w,h,0,packed?gl.DEPTH_STENCIL:gl.DEPTH_COMPONENT,type,null);
    this.textureParameters(gl,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.depthFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,packed?gl.DEPTH_STENCIL_ATTACHMENT:gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.depthTexture,0);
    gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Terrain depth framebuffer is incomplete');
    gl.bindTexture(gl.TEXTURE_2D,this.cloudTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,cw,ch,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    this.textureParameters(gl,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.cloudFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.cloudTexture,0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Cloud framebuffer is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER,target);
  }
  textureParameters(gl,filter) {
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  render(gl,options) {
    if(!this.ready) return;
    const now=performance.now();
    const elapsed=this.last?now-this.last:0;
    if(this.qualityToken!==this.settings.quality){this.qualityToken=this.settings.quality;this.resolutionScale=1;this.slowFrames=0;}
    if(this.last&&this.running&&!this.map.isMoving()&&this.visible&&!document.hidden){
      this.slowFrames=elapsed>65?this.slowFrames+1:Math.max(0,this.slowFrames-1);
      if(this.slowFrames>30&&this.resolutionScale>0.55){this.resolutionScale=Math.max(0.55,this.resolutionScale*0.85);this.slowFrames=0;}
    }
    if(this.last&&this.running&&this.visible&&!document.hidden&&this.settings.enabled) {
      this.windOffset=advanceWind(this.windOffset,this.settings.wind,this.settings.direction,Math.min(1,elapsed/1000));
    }
    this.last=now;
    const state={
      draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
      viewport:gl.getParameter(gl.VIEWPORT),program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
      active:gl.getParameter(gl.ACTIVE_TEXTURE),blend:gl.isEnabled(gl.BLEND),depth:gl.isEnabled(gl.DEPTH_TEST),stencil:gl.isEnabled(gl.STENCIL_TEST),scissor:gl.isEnabled(gl.SCISSOR_TEST),cull:gl.isEnabled(gl.CULL_FACE),
      depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),depthRange:gl.getParameter(gl.DEPTH_RANGE),colorMask:gl.getParameter(gl.COLOR_WRITEMASK),
      src:gl.getParameter(gl.BLEND_SRC_RGB),dst:gl.getParameter(gl.BLEND_DST_RGB),srcA:gl.getParameter(gl.BLEND_SRC_ALPHA),dstA:gl.getParameter(gl.BLEND_DST_ALPHA),eq:gl.getParameter(gl.BLEND_EQUATION_RGB),eqA:gl.getParameter(gl.BLEND_EQUATION_ALPHA)
    };
    const textures=[];
    for(let i=0;i<3;i++){gl.activeTexture(gl.TEXTURE0+i);textures.push([gl.getParameter(gl.TEXTURE_BINDING_2D),gl.getParameter(gl.TEXTURE_BINDING_3D)]);}
    try {
      this.resize(gl,gl.drawingBufferWidth,gl.drawingBufferHeight,state.draw);
      const m=options.defaultProjectionData.mainMatrix;
      const inv=inverse(multiply(m,this.model));
      const eye=[inv[8]/inv[11],inv[9]/inv[11],inv[10]/inv[11]];
      this.eye=eye;
      // Capture AFTER MapLibre draws terrain. This deliberately belongs in render,
      // not prerender: prerender runs before the current terrain depth exists.
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.draw);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.depthFBO);
      gl.blitFramebuffer(0,0,this.w,this.h,0,0,this.w,this.h,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
      if(!this.depthVerified){const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`Terrain depth copy failed (${error})`);this.depthVerified=true;}
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(false);gl.colorMask(true,true,true,true);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this.noiseTexture);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.depthTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.cloudFBO);gl.viewport(0,0,this.cw,this.ch);
      gl.useProgram(this.cloud.p);
      const u=this.cloud.u,s=this.settings;
      const elevation=Math.max(0.06,Math.sin((s.sun-6)/14*Math.PI))*1.10;
      const azimuth=(s.sun-12)*0.19+0.5;
      const sun=[Math.sin(azimuth)*Math.cos(elevation),-Math.cos(azimuth)*Math.cos(elevation),Math.sin(elevation)];
      const warmth=Math.min(1,Math.max(0,(Math.abs(s.sun-12)-2)/4.5));
      gl.uniform1i(u.u_noise,0);gl.uniform1i(u.u_depth,1);
      gl.uniformMatrix4fv(u.u_inverse,false,new Float32Array(inv));gl.uniform3fv(u.u_eye,eye);gl.uniform3fv(u.u_sun,sun);
      gl.uniform2fv(u.u_depthRange,state.depthRange);gl.uniform2fv(u.u_windOffset,this.windOffset);
      gl.uniform1f(u.u_coverage,s.enabled?s.coverage/100:0);gl.uniform1f(u.u_base,s.altitude);gl.uniform1f(u.u_thickness,s.thickness);
      gl.uniform1f(u.u_warmth,warmth);gl.uniform1i(u.u_steps,qualityPresets[s.quality].steps);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.bindFramebuffer(gl.FRAMEBUFFER,state.draw);gl.viewport(...state.viewport);
      gl.useProgram(this.composite.p);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.cloudTexture);
      const c=this.composite.u;
      gl.uniform1i(c.u_cloud,2);gl.uniform1i(c.u_depth,1);gl.uniform2f(c.u_cloudSize,this.cw,this.ch);
      gl.uniform2f(c.u_nearFar,options.nearZ,options.farZ);gl.uniformMatrix4fv(c.u_inverse,false,new Float32Array(inv));gl.uniform3fv(c.u_eye,eye);
      gl.uniform2fv(c.u_depthRange,state.depthRange);
      gl.uniform1f(c.u_warmth,warmth);gl.uniform1f(c.u_enabled,+s.enabled);
      gl.drawArrays(gl.TRIANGLES,0,3);
      this.frames++;
      if(now-this.lastMetric>1500){this.onStatus({fps:this.frames*1000/(now-this.lastMetric),ready:true});this.frames=0;this.lastMetric=now;}
    } catch(error) {this.fail(error);}
    finally {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,state.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.read);gl.viewport(...state.viewport);
      gl.useProgram(state.program);gl.bindVertexArray(state.vao);
      for(const [key,cap] of [['blend',gl.BLEND],['depth',gl.DEPTH_TEST],['stencil',gl.STENCIL_TEST],['scissor',gl.SCISSOR_TEST],['cull',gl.CULL_FACE]]) state[key]?gl.enable(cap):gl.disable(cap);
      gl.depthMask(state.depthMask);gl.colorMask(...state.colorMask);
      gl.blendEquationSeparate(state.eq,state.eqA);gl.blendFuncSeparate(state.src,state.dst,state.srcA,state.dstA);
      for(let i=0;i<3;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i][0]);gl.bindTexture(gl.TEXTURE_3D,textures[i][1]);}
      gl.activeTexture(state.active);
    }
    if(this.ready&&this.visible&&!document.hidden&&((this.running&&this.settings.enabled&&this.settings.wind>0&&this.settings.coverage>0)||this.settings.orbit))this.map.triggerRepaint();
  }
  onRemove(map,gl) {
    for(const p of [this.cloud,this.composite])if(p)gl.deleteProgram(p.p);
    for(const t of [this.cloudTexture,this.depthTexture,this.noiseTexture])if(t)gl.deleteTexture(t);
    for(const f of [this.cloudFBO,this.depthFBO])if(f)gl.deleteFramebuffer(f);
    if(this.vao)gl.deleteVertexArray(this.vao);this.ready=false;
  }
}
