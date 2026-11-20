# Video Upscaler WebGPU V1

**Chạy ngay trên Chrome/Edge, không cài ứng dụng.** Xử lý hoàn toàn trên GPU cục bộ bằng WebGPU. Video không upload lên server.

## Giới hạn quan trọng

Đây là **bản thử nghiệm upscale GPU 2× và sharpen, KHÔNG phải AI / Real-ESRGAN**. Chưa có model neural network, nên không tạo ra chi tiết mới như Video2X. Việc tích hợp model ONNX/WebGPU đã kiểm thử là công việc của V2.

Bản V1 xử lý video **theo thời gian thực** với `HTMLVideoElement`, WebGPU, `canvas.captureStream(0)` và MediaRecorder. Nó giữ audio khi Chrome hỗ trợ AudioContext/MediaRecorder. MP4 chỉ xuất khi `MediaRecorder.isTypeSupported` báo có hỗ trợ; nếu không tự động xuất WebM. Trình duyệt có thể thay đổi tốc độ hoặc bỏ frame dưới tải nặng. **Không đảm bảo giữ nguyên FPS gốc hay đồng bộ tuyệt đối**; chưa phù hợp video dài/sản xuất.

## Cách chạy không cần cài gì

1. Tạo repo GitHub công khai, ví dụ `video-upscaler-web`.
2. Upload **index.html** và **app.js** vào thư mục gốc của repo.
3. Vào **Settings → Pages → Build and deployment → Deploy from a branch**. Chọn `main` và `/ (root)`, rồi Save.
4. Mở URL `https://<username>.github.io/video-upscaler-web/` bằng Chrome hoặc Edge mới.
5. Chọn MP4 H.264 ngắn (5–15 giây, 480p hoặc 720p), chọn 2×, nhấn Bắt đầu xử lý, đợi xong và nhấn Tải video.

Không cần cài Node.js/Python/FFmpeg/Video2X. HTTPS từ GitHub Pages cần thiết để WebGPU hoạt động. Máy GTX 8 GB nên thử clip 480p trước, sau đó 720p.

## Kiểm tra lỗi

- `WebGPU chưa sẵn sàng`: kiểm tra Chrome mới, driver và `chrome://gpu`.
- Video xuất ra không có âm thanh: trình duyệt hoặc codec không hỗ trợ ghi audio qua MediaRecorder; thử MP4 H.264 + AAC.
- MP4 không khả dụng: ứng dụng xuất WebM, có thể phát bằng Chrome.
- FPS không đều: đây là giới hạn của bản realtime V1, sẽ khắc phục bằng WebCodecs + demux/mux trong V2.
- Để tab ở foreground khi xử lý.

## Bảo mật

Toàn bộ xử lý thực hiện trong browser; GitHub Pages chỉ cung cấp mã HTML/JS. File video người dùng chọn không được gửi lên mạng bởi mã ứng dụng này.
