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

Test/dev chạy trên stack Docker mô phỏng Railway; Railway chỉ dùng để debug hoặc truy
xuất dữ liệu khi người dùng yêu cầu. Mọi thao tác phải theo đúng ranh giới dưới đây.

### 7.1. Test / development

- DB test/dev là Postgres trong `infra/docker-compose.yml`, cấu hình giống Railway
  (Postgres 18.6 Debian, `TimeZone=Etc/UTC`, `max_connections=500`, DB `railway`). Web và
  worker test theo đúng lệnh build/start/preDeploy/healthcheck của `.railway/railway.ts`.
  Cho phép migrate, seed, reset, `prisma db push`, integration test và backup/restore
  drill trên stack này mà không cần hỏi từng lần.
- `TEST_DATABASE_URL` (và `DATABASE_URL` khi chạy web/worker để test) phải trỏ vào
  Postgres Docker. Agent kiểm tra host trước khi chạy test: nếu URL trỏ tới Railway
  (`*.rlwy.net`, `*.railway.internal`, `*.up.railway.app`) thì dừng và báo, không chạy.
  Không fallback sang `DATABASE_URL` Railway.
- KHÔNG dùng: Postgres cài trực tiếp trên máy (scoop/Postgres.app/service Windows, cluster
  tạm), SQLite, hay Postgres khác version với Railway. Khi version Postgres trên Railway
  đổi, cập nhật image Docker trong cùng thay đổi.
- Nếu Docker không chạy được: dừng và báo người dùng; không tự chuyển sang DB khác.

### 7.1b. Railway (debug / truy xuất dữ liệu)

- Chỉ khi người dùng yêu cầu tường minh. Được phép: đọc log, status, cấu hình
  (`railway logs`, `railway status`, `railway config pull/plan`), kiểm tra kết nối, và
  truy vấn đọc (`SELECT`, `EXPLAIN`, `information_schema`) trên DB Railway.
- Không tự chạy trên Railway: test suite, migrate, seed, `prisma db push`, script một lần,
  `railway config apply`, hay bất kỳ lệnh ghi nào. Nếu người dùng yêu cầu ghi: áp dụng quy
  trình của mục 7.2.

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

## 8. Tổng hợp file đã thay đổi khi hoàn thành

- Cuối mỗi phản hồi hoàn thành công việc có sửa file, thêm mục **File đã thay đổi** ở
  cuối câu trả lời. Chỉ liệt kê những file agent đã sửa, tạo mới hoặc xoá trong công
  việc đó; không nhận các thay đổi có sẵn của người dùng là do agent thực hiện.
- Nêu tổng số file theo từng loại: sửa, tạo mới, xoá. Với mỗi file sửa, tóm tắt ngắn
  nội dung đã đổi và mục đích. Với mỗi file tạo mới, ghi rõ lý do cần thêm file đó.
  Với file xoá, ghi lý do xoá. Có thể nhóm các file cùng mục đích để dễ đọc nhưng
  vẫn phải nhận diện được từng file.
- Phần tổng hợp này phải nằm trong phản hồi cuối cùng để người dùng nắm được thay đổi
  mà không cần đọc các cập nhật giữa chừng hoặc tự xem `git diff`.
