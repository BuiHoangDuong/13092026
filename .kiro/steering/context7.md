---
inclusion: always
---

# Tra cứu tài liệu thư viện bằng Context7

- Khi triển khai hoặc review hành vi phụ thuộc framework, thư viện, SDK hay API bên ngoài, dùng Context7 để đối chiếu tài liệu trước khi kết luận.
- Đọc phiên bản trong `package.json` và lockfile. Gọi `resolve-library-id`, sau đó `query-docs` với câu hỏi cụ thể và phiên bản phù hợp nếu có. Nếu Context7 không có đúng phiên bản, nêu rõ phiên bản tài liệu dùng để đối chiếu.
- Ưu tiên kiểm tra những điểm ảnh hưởng tính đúng đắn: Next.js routing/auth/cache, React state/effect, Prisma transaction và Zod validation.
- Requirements, design và tasks trong `.kiro/specs/` vẫn quyết định nghiệp vụ. Tài liệu thư viện không thay thế quyết định của dự án.
- Không gửi credential, biến môi trường bí mật, dữ liệu người dùng hoặc báo cáo giao dịch vào truy vấn Context7. Dùng mô tả kỹ thuật và ví dụ tối thiểu đã loại dữ liệu riêng tư.
- Nếu MCP Context7 chưa được nạp vào phiên, có thể gọi endpoint đã cấu hình `https://mcp.context7.com/mcp` bằng giao thức MCP. Nếu dịch vụ không truy cập được, báo rõ và dùng tài liệu chính thức; không tuyên bố đã dùng Context7 khi chưa nhận được kết quả.
- Trong kết quả review, ghi ngắn gọn nội dung đã đối chiếu, kiểm tra đã chạy và giới hạn còn lại.
