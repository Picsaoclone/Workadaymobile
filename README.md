# Workaday Mobile

Workaday Mobile là ứng dụng di động dành cho nhân sự và vận hành nội bộ: giao tiếp, phối hợp công việc, chấm công và các quy trình HR — tất cả trong một trải nghiệm gọn gàng, realtime.

> Đây là **frontend mobile** (React Native/Expo). Mã nguồn ứng dụng nằm trong thư mục `mobile-app/`.

## Điểm nổi bật

- **Onboarding nhanh**: đăng ký/đăng nhập, tham gia công ty bằng **mã mời/invite code**, tối ưu cho triển khai theo phòng ban.
- **Giao tiếp realtime**: chat theo kênh và nhắn tin 1-1 (DM) với cập nhật tức thời.
- **Chia sẻ tệp & hình ảnh**: gửi/nhận file trong hội thoại, xem trước và tải xuống.
- **Thông báo thông minh**: push notification cho tin nhắn và sự kiện quan trọng, giúp không bỏ lỡ việc cần làm.
- **Chấm công & nghỉ phép**: hỗ trợ nghiệp vụ HR thường ngày ngay trên điện thoại.
- **Tổng quan cá nhân**: màn hình Home/Dashboard tập trung vào thứ “cần làm ngay”.

## Tính năng chính

- **Công việc (Tasks)**: giao việc, theo dõi trạng thái, cập nhật tiến độ.
- **Dự án (Projects)**: quản lý công việc theo dự án và thành viên tham gia.
- **Giao tiếp (Communication)**:
  - Kênh (channels) theo nhóm/phòng ban
  - DM (1-1)
  - Realtime qua Socket.IO
- **Chấm công (Attendance)**: ghi nhận thời gian, xem lịch sử.
- **Nghỉ phép (Leave)**: tạo yêu cầu, theo dõi trạng thái duyệt.
- **Báo cáo (Reports)**: tổng hợp/hiển thị báo cáo theo luồng nghiệp vụ.
- **Hồ sơ (Profile)**: thông tin cá nhân, avatar, thiết lập cơ bản.

## Trải nghiệm sản phẩm

- Thiết kế hướng tác vụ: ít thao tác, tập trung vào luồng làm việc.
- Cập nhật tức thời cho hội thoại và trạng thái công việc.
- Tích hợp chặt với backend Workaday để dữ liệu nhất quán và có thể mở rộng.

## Công nghệ

- React Native + Expo (TypeScript)
- Socket.IO cho realtime
- Push Notifications (Expo/FCM tuỳ cấu hình)
- Tích hợp dịch vụ gọi thoại/video (native module)
