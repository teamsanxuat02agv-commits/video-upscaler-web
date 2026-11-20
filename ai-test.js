import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs';
const $ = id => document.getElementById(id);
const say = s => { $('status').textContent=s; $('log').textContent+=s+'\n'; };
let previewURL, downloadURL;
$('photo').addEventListener('change', () => {
 if(previewURL) URL.revokeObjectURL(previewURL);
 const f=$('photo').files[0]; if(f) {$('preview').src=previewURL=URL.createObjectURL(f);}
});
function tensorForTile(ctx,x0,y0,w,h){
 const {data}=ctx.getImageData(x0,y0,w,h), arr=new Float32Array(3*64*64);
 for(let y=0;y<h;y++) for(let x=0;x<w;x++){
   const s=(y*w+x)*4, d=y*64+x;
   for(let c=0;c<3;c++) arr[c*4096+d]=data[s+c]/255;
 }
 return new ort.Tensor('float32',arr,[1,3,64,64]);
}
function paintTile(ctx,tensor,x0,y0,w,h){
 const shape=tensor.dims;
 if(shape.length!==4||shape[0]!==1||shape[1]!==3||shape[2]!==256||shape[3]!==256) throw Error('Model không trả về [1,3,256,256]: '+JSON.stringify(shape));
 const src=tensor.data, pixels=new Uint8ClampedArray(256*256*4);
 for(let y=0;y<256;y++) for(let x=0;x<256;x++){
   const p=y*256+x;for(let c=0;c<3;c++)pixels[4*p+c]=Math.round(Math.max(0,Math.min(1,src[c*65536+p]))*255);
   pixels[4*p+3]=255;
 }
 const tmp=document.createElement('canvas');tmp.width=tmp.height=256;
 tmp.getContext('2d').putImageData(new ImageData(pixels,256,256),0,0);
 ctx.drawImage(tmp,0,0,w*4,h*4,x0*4,y0*4,w*4,h*4);
}
$('run').addEventListener('click',async()=>{
 const btn=$('run'); btn.disabled=true;$('log').textContent='';$('download').hidden=true;$('progress').value=0;
 try{
  const model=$('model').files[0], photo=$('photo').files[0];
  if(!model||!photo)throw Error('Hãy chọn cả file ONNX và ảnh.');
  if(!navigator.gpu)throw Error('Chrome chưa bật WebGPU.');
  say('Đang tải ONNX Runtime WebGPU...');
  const session=await ort.InferenceSession.create(await model.arrayBuffer(),{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
  say('Đã tạo session WebGPU. Input: '+session.inputNames.join(', '));
  const bmp=await createImageBitmap(photo),w=bmp.width,h=bmp.height;
  if(w>512||h>512)throw Error('Ảnh vượt 512×512. Hãy thử ảnh nhỏ trước.');
  const src=document.createElement('canvas');src.width=w;src.height=h;
  const source=src.getContext('2d',{willReadFrequently:true});source.drawImage(bmp,0,0);
  const out=$('result');out.width=w*4;out.height=h*4;const target=out.getContext('2d');
  const count=Math.ceil(w/64)*Math.ceil(h/64);let done=0;
  for(let y=0;y<h;y+=64)for(let x=0;x<w;x+=64){
   const tw=Math.min(64,w-x),th=Math.min(64,h-y);
   // Edge tiles are padded by repeating the last source pixel, avoiding black seams.
   const tile=document.createElement('canvas');tile.width=tile.height=64;
   const tc=tile.getContext('2d',{willReadFrequently:true});
   tc.drawImage(src,x,y,tw,th,0,0,tw,th);
   if(tw<64)tc.drawImage(tile,tw-1,0,1,th,tw,0,64-tw,th);
   if(th<64)tc.drawImage(tile,0,th-1,64,1,0,th,64,64-th);
   const input=tensorForTile(tc,0,0,64,64);
   const results=await session.run({[session.inputNames[0]]:input});
   paintTile(target,results[session.outputNames[0]],x,y,tw,th);
   done++;$('progress').value=100*done/count;$('status').textContent=`AI WebGPU: ${done}/${count} tiles (${Math.round(100*done/count)}%)`;
   await new Promise(r=>setTimeout(r,0));
  }
  if(downloadURL)URL.revokeObjectURL(downloadURL);
  const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
  if(!blob)throw Error('Không xuất được PNG');
  downloadURL=URL.createObjectURL(blob);$('download').href=downloadURL;$('download').download='realesrgan-4x.png';$('download').hidden=false;
  say('✓ Đã xử lý xong bằng ONNX Runtime WebGPU. Hãy kiểm tra chất lượng ảnh.');
 }catch(e){console.error(e);say('✗ '+(e?.message||String(e)));}
 finally{btn.disabled=false;}
});
