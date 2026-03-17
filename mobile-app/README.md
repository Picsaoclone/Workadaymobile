# Workaday Mobile

Ứng dụng di động dành cho vận hành nội bộ: giao tiếp, phối hợp công việc, chấm công và các quy trình HR — tập trung vào trải nghiệm “làm việc nhanh, cập nhật tức thời”.

## Tổng quan tính năng

- **Onboarding theo tổ chức**: đăng ký/đăng nhập, tham gia công ty bằng **mã mời (invite code)**.
- **Dashboard tập trung**: hiển thị đúng thứ người dùng cần làm ngay.
- **Giao tiếp realtime**:
  - Chat theo kênh (channels) cho nhóm/phòng ban
  - Nhắn tin 1-1 (DM)
  - Đồng bộ realtime qua Socket.IO
- **Chia sẻ tệp & hình ảnh**: gửi/nhận file trong hội thoại, xem trước và tải xuống.
- **Thông báo thông minh**: push notifications cho tin nhắn và sự kiện quan trọng.
- **Chấm công & nghỉ phép**: hỗ trợ nghiệp vụ HR hằng ngày ngay trên điện thoại.

## Các phân hệ chính

- **Tasks**: giao việc, theo dõi trạng thái, cập nhật tiến độ.
- **Projects**: quản lý công việc theo dự án và thành viên.
- **Communication**: kênh chat/DM, realtime.
- **Attendance**: ghi nhận và xem lịch sử chấm công.
- **Leave**: tạo yêu cầu nghỉ phép và theo dõi phê duyệt.
- **Reports**: hiển thị báo cáo theo luồng nghiệp vụ.
- **Profile**: thông tin cá nhân và thiết lập cơ bản.

## Công nghệ

- React Native + Expo (TypeScript)
- Socket.IO (realtime)
- Push Notifications (Expo/FCM tuỳ cấu hình)
