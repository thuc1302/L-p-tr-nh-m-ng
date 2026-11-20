# Chatly

Hệ thống nhắn tin trực tuyến trên website theo mô hình Client–Server.

Chức năng chính: nhắn tin 1-1 thời gian thực, gửi ảnh, gọi thoại và gọi video, quản lý tài khoản
(hồ sơ, đổi tên đăng nhập, email, mật khẩu), xem hồ sơ người khác, trang quản trị.

| Thành phần | Công nghệ |
| --- | --- |
| Client và trang quản trị | React, Vite, Nginx |
| Server | Node.js, Express (REST API), Socket.IO (thời gian thực, báo hiệu cuộc gọi) |
| Cuộc gọi | WebRTC: âm thanh/hình ảnh đi trực tiếp giữa hai trình duyệt |
| Cơ sở dữ liệu | PostgreSQL 17 |
| Quản trị CSDL | pgAdmin 4 |

## Chạy hệ thống

Cần Docker và Docker Compose. Lần đầu, tạo file cấu hình rồi đổi mật khẩu trong `.env`:

```bash
cp .env.example .env
docker compose up -d --build
```

| Địa chỉ | Dùng cho |
| --- | --- |
| http://localhost:8080 | Website người dùng và trang quản trị (`/admin`) |
| http://localhost:5050 | pgAdmin 4 |
| `localhost:5433` | PostgreSQL, cho công cụ bên ngoài |
| https://&lt;IP-LAN&gt;:8443 | Website cho máy khác trong mạng LAN |

Tài khoản demo có mật khẩu `Demo@12345`: `an.nguyen`, `binh.tran`, `cuong.le`.
Tài khoản quản trị lấy từ `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env`, tên đăng nhập là `admin`.
Hai giá trị này chỉ có tác dụng khi tài khoản `admin` chưa tồn tại.

## Dùng trên nhiều máy trong mạng LAN

Các máy phải cùng một mạng (cùng Wi-Fi, hoặc cùng điểm phát từ điện thoại).

1. Trong Chatly, mở **Cài đặt → Truy cập từ máy khác** để xem địa chỉ, ví dụ `https://192.168.1.21:8443`.
2. Trên máy khác, mở địa chỉ đó. Trình duyệt sẽ cảnh báo chứng chỉ (vì là chứng chỉ tự ký).
   Bấm **Nâng cao → Tiếp tục truy cập** một lần, sau đó dùng bình thường, kể cả gọi thoại và gọi video.
3. Trên máy chạy Docker, vẫn có thể dùng `http://localhost:8080`.

**Tự cập nhật khi đổi Wi-Fi:** dịch vụ `lan-watch` kiểm tra IP của máy mỗi 5 giây.
Khi IP đổi, nginx tự tạo lại chứng chỉ và nạp lại cấu hình (không ngắt kết nối),
địa chỉ trong mục Cài đặt cũng đổi theo. Không cần sửa file hay chạy lệnh gì.
IP hiện tại được ghi trong `runtime/lan_host`.

Chỉ cổng 8443 được mở ra mạng LAN; pgAdmin và PostgreSQL vẫn chỉ dùng được trên máy chạy Docker.

Nếu máy khác không vào được:
- Kiểm tra lại hai máy có cùng mạng không, và IP có đúng không.
- Mạng trường, mạng công ty hoặc Wi-Fi công cộng thường chặn các máy kết nối với nhau. Khi đó dùng điện thoại phát Wi-Fi cho cả hai máy.
- Nếu máy chạy Docker bật tường lửa: `sudo ufw allow 8443/tcp`.

Cùng một trình duyệt chỉ đăng nhập được một tài khoản (các tab dùng chung cookie).
Để thử hai tài khoản trên một máy, dùng một cửa sổ thường và một cửa sổ ẩn danh, hoặc hai trình duyệt khác nhau.

## Xem bảng bằng pgAdmin

1. Mở http://localhost:5050. Không cần đăng nhập, server **Chatly** đã có sẵn.
2. Mở cây: **Servers → Chatly → Databases → chatly → Schemas → public → Tables**.
3. Xem dữ liệu: chuột phải vào một bảng → **View/Edit Data → All Rows**.
4. Chạy SQL tùy ý: chọn database `chatly` → **Tools → Query Tool**.

Kết nối từ pgAdmin cài ngoài Docker: host `127.0.0.1`, cổng `5433`, thông tin còn lại trong `.env`.

## Các bảng

| Bảng | Nội dung |
| --- | --- |
| `users` | Tài khoản, vai trò, trạng thái khóa |
| `user_sessions` | Phiên đăng nhập (chỉ lưu hash của token) |
| `conversations` | Hội thoại cá nhân |
| `conversation_members` | Thành viên, vị trí đã nhận/đã đọc |
| `messages` | Tin nhắn: văn bản, hình ảnh hoặc bản ghi cuộc gọi (`type`) |
| `attachments` | Ảnh đính kèm; file nằm trong volume `uploads` |
| `calls` | Lịch sử cuộc gọi: loại, trạng thái, thời điểm nghe máy và kết thúc |
| `reports` | Báo cáo vi phạm |
| `admin_audit_logs` | Nhật ký thao tác quản trị |
| `schema_migrations` | Các migration đã áp dụng |

## Gửi ảnh và gọi điện

- Ảnh hỗ trợ JPG, PNG, GIF và WEBP, tối đa 10 MB. Có thể bấm nút ảnh hoặc dán ảnh (Ctrl+V) vào ô nhập tin.
  Chỉ thành viên trong hội thoại mới xem được ảnh.
- Cuộc gọi đổ chuông 30 giây, quá thời gian sẽ thành cuộc gọi nhỡ. Mỗi người chỉ được tham gia một cuộc gọi tại một thời điểm.
- Trình duyệt chỉ cho mở micro/camera trên `localhost` hoặc HTTPS. Máy khác trong LAN dùng địa chỉ `https://<IP>:8443` (xem mục bên trên).
- Hai máy cùng mạng LAN hoặc cùng một máy thì gọi được ngay. Khi hai máy ở hai mạng khác nhau và có tường lửa chặt,
  cần thêm máy chủ TURN vào `ICE_SERVERS` trong `frontend/src/call/useCall.js`.

## Kiểm thử

Test tích hợp chạy trên hệ thống đang hoạt động, bao gồm REST và Socket.IO:

```bash
cd backend && npm install && npm test
```

Test tạo thêm người dùng và tin nhắn thật trong CSDL. Đặt `ADMIN_EMAIL`, `ADMIN_PASSWORD` nếu đã đổi trong `.env`.

## Lệnh thường dùng

```bash
docker compose logs -f backend   # xem log
docker compose down              # dừng, giữ dữ liệu
docker compose down -v           # dừng và XÓA toàn bộ dữ liệu
```
