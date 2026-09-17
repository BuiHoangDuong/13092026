# Spec Governance — Requirements & Design là kim chỉ nam

> Scope: chỉ áp dụng cho workspace này. Đây là steering "always included":
> mọi phiên làm việc của Kiro trong project phải tuân theo.

## 1. Nguyên tắc cốt lõi (Source of Truth)

- `requirements.md` (WHAT/WHY) và `design.md` (HOW) trong `.kiro/specs/<feature>/`
  là **nguồn sự thật duy nhất**. Khi code và spec mâu thuẫn, spec thắng — hoặc code
  được sửa cho khớp, hoặc spec được cập nhật một cách có chủ đích (không bao giờ để
  hai bên "trôi" khỏi nhau trong im lặng).
- **Spec đi trước, code đi sau.** Trước khi implement một thay đổi về hành vi hệ thống,
  cập nhật spec trước, rồi mới viết/sửa code theo spec đã chốt.
- `architecture.html` ở repo root là bối cảnh nền (handoff/context), KHÔNG phải nguồn
  sự thật thi hành. Nếu nó lệch với spec, spec là chuẩn.

## 2. Project sống lâu = doc phải được "dọn", không chồng legacy

Đây là project dự kiến đổi kiến trúc và nghiệp vụ nhiều lần. Doc phải phản ánh trạng
thái **hiện tại đúng**, không phải lịch sử tích tụ.

- **Legacy bị loại bỏ → xoá khỏi doc.** Không giữ lại các mô tả kiến trúc/API/luồng đã
  chết trong `requirements.md` hay `design.md`. Ghi lại việc xoá ở changelog (mục 5),
  không để nằm rải rác gây nhiễu.
- **Nghiệp vụ sai → sửa hoặc loại bỏ khỏi requirement.** Nếu một requirement được xác
  định là sai/không còn đúng nghiệp vụ, cập nhật cho đúng hoặc xoá hẳn; không đánh dấu
  "để đó tính sau" một cách mập mờ.
- Không tạo requirement/design "phòng hờ" cho tính năng chưa quyết. Việc chưa chốt để ở
  mục "Open decisions", không viết thành hành vi bắt buộc (SHALL).
- Ưu tiên doc gọn và đúng hơn doc dài và cũ. Nếu một phần không còn phản ánh hệ thống,
  nó là nợ — hãy trả.

## 3. Quy trình khi thay đổi

1. Xác định thay đổi thuộc WHAT/WHY (→ `requirements.md`) hay HOW (→ `design.md`).
2. Cập nhật spec tương ứng trước: sửa/thêm/xoá nội dung liên quan.
3. Rà **tác động chéo**: một thay đổi requirement thường kéo theo design, data model,
   API surface, và ngược lại. Cập nhật tất cả nơi bị ảnh hưởng trong cùng lần sửa.
4. Xoá sạch nội dung legacy mà thay đổi này làm lỗi thời (đừng chỉ thêm cái mới bên cạnh
   cái cũ).
5. Ghi 1 dòng vào changelog (mục 5).
6. Implement code theo spec đã cập nhật, rồi verify (build/test) khớp với spec.

## 4. Giữ tính nhất quán & truy vết

- **Giữ ổn định định danh requirement** (`Requirement N`) khi còn hiệu lực để dễ tham
  chiếu từ design/code/PR. Khi một requirement bị xoá, KHÔNG tái sử dụng số đó cho nghĩa
  khác — đánh dấu là removed trong changelog thay vì lặng lẽ dời số.
- Acceptance criteria giữ đúng EARS (`WHEN/WHILE/IF ... THE SYSTEM SHALL ...`) và định
  dạng heading chuẩn của spec (`### Requirement N: Title`, `**User Story:**`,
  `#### Acceptance Criteria`).
- `design.md` phải liên kết ngược về requirement mà nó phục vụ; khi requirement đổi,
  soát lại phần design tương ứng ngay.
- Không để giá trị "pending decision" biến thành hành vi bắt buộc cho tới khi được chốt.

## 5. Changelog spec (bắt buộc cập nhật khi sửa spec)

Mỗi lần thay đổi/loại bỏ requirement hoặc design, thêm một dòng vào bảng ở cuối
`requirements.md` hoặc `design.md` (tạo mục "## Changelog" nếu chưa có):

| Ngày | File | Thay đổi | Lý do | Loại (added/updated/removed) |
|------|------|----------|-------|------------------------------|

Ví dụ:

| 2026-09-15 | requirements.md | Bỏ Requirement cũ về "real-time WebSocket sync" | Chuyển sang Phase 4, không thuộc MVP | removed |

## 6. Ranh giới của agent

- Được phép: chủ động dọn legacy trong doc khi nó đã lỗi thời do thay đổi hiện tại, và
  cập nhật các phần bị ảnh hưởng chéo.
- Phải hỏi trước khi: xoá/viết lại diện rộng một requirement/design mà lý do nghiệp vụ
  chưa rõ, hoặc khi thay đổi làm mất một tính năng người dùng đã yêu cầu.
- Khi phát hiện code lệch spec, nêu rõ và đề xuất: sửa code cho khớp spec, hay cập nhật
  spec cho khớp thực tế — không tự ý chọn hướng làm giảm phạm vi.

## 7. Database usage policy (bắt buộc)

Workspace này KHÔNG dùng database local. Mọi thao tác dev/test và production phải theo
đúng ranh giới dưới đây.

### 7.1. Test / development

- Trong giai đoạn pre-golive (xem `production-safety` steering), workspace dùng CHÍNH DB
  Railway hosted (`DATABASE_URL`) làm test/dev DB vì nó chỉ chứa dữ liệu seed/fake. Cho phép
  migrate, seed, reset, `prisma db push`, chạy integration test và backup/restore drill
  trực tiếp trên DB này mà không cần hỏi từng lần.
- Vẫn KHÔNG dùng: Postgres local (Docker/Postgres.app/service Windows) hay
  `localhost`/`127.0.0.1`, và KHÔNG dùng SQLite hay DB thay thế nào khác. Nếu cần một DB
  test riêng biệt, tạo trên Railway chứ không tạo local.
- Nếu `TEST_DATABASE_URL` không được set, integration test dùng `DATABASE_URL` (DB Railway
  pre-golive) — không fallback sang local.
- Sau go-live thật, mục này sẽ được siết lại về "chỉ dùng Postgres test tách biệt".

### 7.2. Production

- Với production database, agent **chỉ được thực hiện thao tác đọc** (`SELECT`, `EXPLAIN`,
  `\d`, `information_schema`...). Đọc để chẩn đoán, kiểm chứng dữ liệu, viết migration
  plan là OK.
- Mọi thao tác ghi hoặc thay đổi cấu trúc trên production PHẢI do người dùng trực tiếp
  xác nhận và (mặc định) do người dùng tự chạy. Bao gồm nhưng không giới hạn:
  - `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, `COPY ... FROM`.
  - `ALTER`, `CREATE`, `DROP`, `RENAME`, thay đổi index/constraint/trigger/role/policy.
  - `prisma migrate deploy`, `prisma db push`, `prisma db execute` trên URL production.
  - Chạy script một lần (`*.mjs`, `*.ts`, `*.sql`, `railway run ...`) ghi vào production DB.
- Quy trình đúng khi cần thay đổi production:
  1. Agent mô tả rõ lệnh/script sẽ chạy và tác động dự kiến.
  2. Chờ người dùng xác nhận tường minh ("OK", "chạy đi"...).
  3. Ưu tiên để người dùng tự thực thi; nếu người dùng yêu cầu agent chạy, agent chạy
     đúng lệnh đã được duyệt, không tự "mở rộng" phạm vi.
- Không bao giờ dùng credential production để chạy test suite, seed, hoặc bất kỳ tác vụ
  dev nào — kể cả khi "chỉ để thử".

Quy tắc này bổ sung cho `production-safety` steering; khi hai bên chồng lấn, chọn diễn
giải nghiêm ngặt hơn.
