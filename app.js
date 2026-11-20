const $ = (id) => document.getElementById(id);
const file = $('file'), video = $('input'), canvas = $('output');
let adapter, device, gpu, recorder, stopRequested=false, running=false, url=null, stream=null, audioCtx=null, sourceNode=null;
const log = (s) => { $('log').textContent += s+'\n'; };
const status = (s) => { $('status').textContent=s; };

const shader = `
struct Params { srcSize: vec2f, sharp: f32, padding: f32 };
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
 var pos = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
 var o: Out; o.position=vec4f(pos[i],0.,1.); o.uv=vec2f((pos[i].x+1.)*.5,(1.-pos[i].y)*.5); return o;
}
fn sampleAt(uv:vec2f)->vec3f { return textureSample(srcTex,srcSampler,uv).rgb; }
@fragment fn fs(i:Out)->@location(0) vec4f {
 let t=1./p.srcSize;
 let c=sampleAt(i.uv);
 let blur=(sampleAt(i.uv+vec2f(t.x,0.))+sampleAt(i.uv-vec2f(t.x,0.))+sampleAt(i.uv+vec2f(0.,t.y))+sampleAt(i.uv-vec2f(0.,t.y)))*.25;
 return vec4f(clamp(c+(c-blur)*p.sharp,vec3f(0.),vec3f(1.)),1.);
}`;

async function init(){
 if(!navigator.gpu) throw Error('Trình duyệt không hỗ trợ WebGPU. Hãy dùng Chrome/Edge mới trên HTTPS.');
 adapter=await navigator.gpu.requestAdapter();
 if(!adapter) throw Error('Không tìm thấy WebGPU adapter. Kiểm tra chrome://gpu và driver GPU.');
 device=await adapter.requestDevice();
 const context=canvas.getContext('webgpu');
 const format=navigator.gpu.getPreferredCanvasFormat();
 const module=device.createShaderModule({code:shader});
 const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
 const sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
 gpu={context,format,pipeline,sampler};
 status('WebGPU sẵn sàng. Hãy chọn video.');
 log('✓ WebGPU NVIDIA/adapter sẵn sàng');
}

file.addEventListener('change',()=>{
 if(url) URL.revokeObjectURL(url);
 const f=file.files?.[0]; if(!f)return;
 url=URL.createObjectURL(f);video.src=url;video.load();
 $('download').hidden=true;$('progress').value=0;$('log').textContent='';
});
video.addEventListener('loadedmetadata',()=>{
 const w=video.videoWidth,h=video.videoHeight;
 $('info').textContent=`${w} × ${h} • ${video.duration.toFixed(1)} giây • ${(file.files[0].size/1048576).toFixed(1)} MB`;
 $('start').disabled=!gpu || running;
});

function makeGpuResources(width,height,scale,sharp){
 const ow=width*scale,oh=height*scale;
 if(ow>device.limits.maxTextureDimension2D||oh>device.limits.maxTextureDimension2D) throw Error('Độ phân giải vượt giới hạn WebGPU.');
 canvas.width=ow;canvas.height=oh;
 gpu.context.configure({device,format:gpu.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT});
 const tex=device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(uniform,0,new Float32Array([width,height,sharp,0]));
 const bind=device.createBindGroup({layout:gpu.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:tex.createView()},{binding:1,resource:gpu.sampler},{binding:2,resource:{buffer:uniform}}]});
 return {tex,uniform,bind};
}
function drawFrame(res){
 device.queue.copyExternalImageToTexture({source:video},{texture:res.tex},[video.videoWidth,video.videoHeight]);
 const enc=device.createCommandEncoder();
 const pass=enc.beginRenderPass({colorAttachments:[{view:gpu.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store'}]});
 pass.setPipeline(gpu.pipeline);pass.setBindGroup(0,res.bind);pass.draw(6);pass.end();device.queue.submit([enc.finish()]);
}
function chooseMime(){
 const types=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4;codecs="avc1.42E01E"','video/webm;codecs="vp9,opus"','video/webm;codecs="vp8,opus"','video/webm'];
 return types.find(t=>MediaRecorder.isTypeSupported(t)) || '';
}
function awaitEvent(el,event){return new Promise((resolve,reject)=>{const ok=()=>{clean();resolve();},bad=()=>{clean();reject(Error('Không đọc được video.'));},clean=()=>{el.removeEventListener(event,ok);el.removeEventListener('error',bad);};el.addEventListener(event,ok,{once:true});el.addEventListener('error',bad,{once:true});});}

async function start(){
 if(running||!file.files?.length)return;
 running=true;stopRequested=false;$('start').disabled=true;$('stop').disabled=false;$('download').hidden=true;$('progress').value=0;
 let res=null, outputStream=null, done=null;
 try{
  if(!gpu)throw Error('WebGPU chưa sẵn sàng');
  video.pause();video.currentTime=0;
  if(video.readyState<2) await awaitEvent(video,'loadeddata');
  const scale=Number($('scale').value),sharp=Number($('sharp').value);
  res=makeGpuResources(video.videoWidth,video.videoHeight,scale,sharp);
  drawFrame(res);
  // Capture output frames in real time. Browser tab must remain active.
  if(!canvas.captureStream)throw Error('Chrome không hỗ trợ canvas.captureStream');
  outputStream=canvas.captureStream(0);
  const track=outputStream.getVideoTracks()[0];
  if(!track.requestFrame)throw Error('CanvasCaptureMediaStreamTrack.requestFrame không được hỗ trợ.');
  // Connect original audio to recorder, if the input contains an audio track.
  try{
   audioCtx ||= new AudioContext();
   sourceNode ||= audioCtx.createMediaElementSource(video);
   const dest=audioCtx.createMediaStreamDestination();
   sourceNode.connect(dest);sourceNode.connect(audioCtx.destination);
   await audioCtx.resume();
   for(const a of dest.stream.getAudioTracks())outputStream.addTrack(a);
  }catch(e){log('Âm thanh không khả dụng: '+e.message);}
  const mime=chooseMime();if(!mime)throw Error('Không tìm thấy MediaRecorder codec phù hợp');
  const chunks=[];
  recorder=new MediaRecorder(outputStream,{mimeType:mime,videoBitsPerSecond:8_000_000});
  done=new Promise((resolve,reject)=>{
   recorder.ondataavailable=(e)=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=(e)=>reject(e.error||Error('MediaRecorder lỗi'));
   recorder.onstop=()=>resolve();
  });
  recorder.start(1000);
  status('Đang xử lý video trên GPU (thời gian thực)…');
  log(`Đầu ra: ${canvas.width} × ${canvas.height}; MIME: ${mime}`);
  // requestVideoFrameCallback ensures only decoded video frames are processed.
  let frameCount=0,callbackError=null;
  const onFrame=(_now,meta)=>{
   if(stopRequested||!running)return;
   try{
    drawFrame(res);track.requestFrame();frameCount++;
    $('progress').value=Math.min(100,100*meta.mediaTime/video.duration);
    status(`Đang xử lý ${$('progress').value.toFixed(1)}% • ${frameCount} frames`);
    video.requestVideoFrameCallback(onFrame);
   }catch(e){callbackError=e;stopRequested=true;video.pause();}
  };
  video.requestVideoFrameCallback(onFrame);
  const ended=new Promise(resolve=>{video.addEventListener('ended',resolve,{once:true});const check=setInterval(()=>{if(stopRequested||video.ended){clearInterval(check);resolve();}},150);});
  await video.play();
  await ended;
  video.pause();
  if(recorder.state!=='inactive')recorder.stop();
  await done;
  if(callbackError)throw callbackError;
  const actualMime=recorder.mimeType||mime;
  const ext=actualMime.includes('mp4')?'mp4':'webm';
  const blob=new Blob(chunks,{type:actualMime});
  if(!blob.size)throw Error('Không thu được dữ liệu video đầu ra');
  const link=$('download');
  if(link.dataset.url)URL.revokeObjectURL(link.dataset.url);
  link.dataset.url=URL.createObjectURL(blob);link.href=link.dataset.url;
  link.download=`upscaled_${scale}x.${ext}`;link.textContent=`⬇ Tải video ${ext.toUpperCase()} (${(blob.size/1048576).toFixed(1)} MB)`;link.hidden=false;
  status(stopRequested?'Đã dừng. Có thể tải phần video đã xử lý.':'✓ Hoàn tất. Tải video ở nút bên cạnh.');
  log(`✓ Xuất ${ext.toUpperCase()} thành công (${frameCount} frames)`);
 }catch(e){console.error(e);status('Lỗi: '+e.message);log('✗ '+e.message);if(recorder?.state==='recording')recorder.stop();}
 finally{
  stopRequested=true;running=false;$('stop').disabled=true;$('start').disabled=!gpu;
  outputStream?.getTracks().forEach(t=>t.stop());
  res?.tex.destroy();res?.uniform.destroy();
 }
}
$('start').addEventListener('click',start);
$('stop').addEventListener('click',()=>{stopRequested=true;video.pause();status('Đang kết thúc bản ghi…');});
init().catch(e=>{status(e.message);log('✗ '+e.message);});
