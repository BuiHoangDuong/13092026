# Phương án các phần còn lại sau Dark Aurora

Ngày rà soát: 2026-10-14. Phạm vi: đề xuất thứ tự triển khai dựa trên requirements/design/tasks và source hiện tại; chưa triển khai các nhóm nghiệp vụ bên dưới. Specs vẫn là nguồn sự thật, tài liệu này không tự đóng quyết định mở hoặc phê duyệt production/mainnet.

## 1. Trạng thái và thứ tự đề xuất

Dark Aurora đã có code ở Task 40.1–40.4. Đợt QA tiếp theo bổ sung tests tương tác DOM và cập nhật Docker theo source mới; Task 40.5 vẫn cần visual QA thực tế. Giữ `http://localhost:3000` chạy cho người dùng kiểm tra.

| Ưu tiên | Nhóm | Task/requirement | Có thể làm tiếp | Điều kiện trước khi kết luận hoàn thành |
| --- | --- | --- | --- | --- |
| 1 | Hoàn tất QA giao diện | 40.5; Req 19–20 | Build/tests Docker, tests DOM calculator/lookup/menu, sửa lỗi tìm được | Browser QA 360–1440px, ảnh đối chiếu, keyboard/contrast/reduced motion. DOM tests không chứng minh layout. |
| 2 | Kiểm chứng luồng dữ liệu → tiền → ví | 18; Tasks 10/11/13/14/23/24/25 | Chạy lại integration hiện có bằng fixtures trong schema Docker riêng; sửa lỗi nếu tái hiện | Đủ bằng chứng idempotency, concurrency, corrections, release holds, OTP/session, reserve/cancel/approve/paid; không gửi email/coin thật. |
| 3 | Kiểm chứng connector activity | 20.5 và phần fixture của 20.6 | Fixture/unit/integration Bybit/MEXC/Binance, coverage, retry/429/lease/drift/raw load | Đối soát period/UID trên dữ liệu sàn thực trước live rollout. API activity không tự là commission thanh toán. |
| 4 | Vận hành và độ tin cậy | 19; Req 6.5/12 | Docker worker health/heartbeat/alerts, runbook, backup/restore vào DB Docker tạm | Kiểm chứng cấu hình triển khai hiện tại và quy trình restore; Railway cần yêu cầu riêng, không áp plan cấu hình cũ. |
| Chờ dữ liệu | Native import và MEXC payable commission | 10.2, 10.8, 11.1; Open decision #11 | Chuẩn bị checklist mapping/đối soát theo adapter framework đã có | Report commission UID-level có số khác 0, đơn vị, kỳ, settlement và identity; native Bybit cần sample thật. |
| Chờ quyết định | Auto payout ETH/BNB/SOL | Req 21; Task 39 | Hoàn thiện design/decision matrix và test scenarios theo spec | #19, #26–32: lịch, USD valuation, asset conversion, signer, phí/finality/limits và testnet. Sender hiện chưa có implementation. |
| Chưa cần | SSE / phân vùng facts | 21 / 29 | Giữ deferred theo task hiện tại | SSE chỉ khi có nhu cầu; Task 29 chỉ khi gần 5,000 UIDs/day hoặc có bằng chứng p95/scan theo task. |

Đề xuất bắt đầu nhóm **2** sau QA UI. Luồng tiền đã có implementation và scripts kiểm tra, nên ưu tiên xác nhận nó trước khi mở rộng payout/connector mới. Nhóm 3–4 dùng fixtures/Docker làm độc lập được, không cần bật schedule thật.

## 2. Đợt tiếp theo: kiểm chứng end-to-end trên Docker

### Chuẩn bị bộ chạy test

- Chỉ nhận `TEST_DATABASE_URL` rõ ràng, kiểm tra host Docker trước khi migrate/create schema. Không fallback sang `DATABASE_URL`. Source `scripts/test-uid-access.mjs` hiện còn fallback, cần sửa runner này trước khi chạy lại; rà cùng quy tắc trên các scripts còn lại.
- Mỗi integration dùng schema tên riêng, giữ dữ liệu public của localhost để người dùng tiếp tục xem. Cleanup có `finally`, chỉ xóa schema/fixtures do test tạo và kiểm tra kết quả dọn.
- Mock email transport, exchange fetch, RPC và signer; không lấy secret thật để test. `test-uid-access.mjs` hiện blank email credentials cho web con nên có thể đánh giá availability/auth mà không gửi thư thật.
- Build dependencies trong Docker và khớp schema migration trước test. Không chạy worker với `.env` thật/schedule đang bật để thay thế fixture test.

### Thứ tự scripts có sẵn

| Bộ kiểm tra | File | Bằng chứng cần giữ |
| --- | --- | --- |
| Import → publish → attribution → hold/withdraw | `scripts/test-bybit-integration.mjs` | Retry/corrections không credit trùng; publish fail rollback; race không double spend; cancel/release/audit đúng. |
| Lookup → UID session/withdraw auth | `scripts/test-uid-access.mjs` | Opaque UID, public/private response boundaries, rate limits, thiếu session không truy cập ví/rút tiền. |
| UID rekey/corrections | `scripts/test-uid-rekey.mjs` | Không đổi nhầm account/wallet, các khóa liên quan và lịch sử còn đúng. |
| MEXC native activity | `scripts/test-mexc-activity.mjs` | Snapshot/zero/missing-day/correction, raw transform và overrides không thành payable commission. |
| Scheduled activity | `scripts/test-bybit-sync.mjs` | Digest/coverage/lease/scheduler, lỗi giữ published data cũ, không ghi ví từ activity. |
| Binance GET-only | `scripts/test-binance-sync.mjs` | Raw intake/readiness/counts, không ghi normalized UID activity/commission/wallet. |

Rà setup/assertions của từng script trước khi chạy; đây là danh sách source hiện có, không phải tuyên bố tất cả đã chạy đạt trong đợt QA UI này. Không chạy đồng thời các script dùng DB/global config chung khi chưa xác nhận isolation. Nếu script cần môi trường shell/tool đặc biệt, chạy trong container phù hợp với stack repo.

**Đầu ra:** bản kết quả có command, môi trường, pass/fail, invariant và cleanup; chỉ đánh dấu Task 18 hoàn thành khi đủ checks. Lỗi được sửa theo spec trước, thêm regression test đúng trigger, rồi chạy lại phần bị ảnh hưởng.

## 3. Đối soát sàn: tách fixture checks với data gate

- **Bybit:** connector/activity sync đã có; pending/settled của commission cần đối chiếu report portal. `commissionsVol` hoặc số liệu activity không tự quyết định tiền available. Task 20.5 còn gồm đối soát ngày/UID và rollout sau fixture checks.
- **MEXC:** Task 20.6 ghi code và Docker integration đã đạt 2026-10-07, còn root UID configuration và live period reconciliation. Task 10.8 cần export activity khác 0 + timezone; Task 11.1 cần commission export riêng. Không viết lại connector từ đầu hoặc dùng `Your Earnings` snapshot làm chứng cứ payable commission.
- **Binance:** GET-only đã có raw intake và fetched counts, chưa có mapping customerId → UID/period đã xác minh. Xác định hợp đồng/mapping đó trước khi đề xuất publish activity hoặc cashback; việc có card Binance trên homepage không chứng minh dữ liệu ví đã đồng bộ.
- Report/source private dùng cho mapping, không đưa lên public repo hay test fixture công khai. Không gọi API live trong đợt kiểm tra fixtures.

**Đầu ra:** bảng field mapping, timezone/period/asset semantics, identity/dedup key, totals đối soát và mẫu đã loại thông tin riêng. Sau khi evidence đạt mới cập nhật adapter/spec/task tương ứng.

## 4. Vận hành: phần làm local trước

- Kiểm tra `/api/health`, queue age, worker heartbeat khi idle/chạy job, alert state và recovery bằng fixtures.
- Rà `docs/operations.md`, `.railway/railway.ts` và `scripts/verify-postgres-backup.ps1`; diễn tập backup/restore trên Docker vào DB tạm, đối chiếu migrations/counts trước và sau, dọn đúng target.
- Task 19 còn lưu một plan Railway từ 2026-09-17 có bước xóa `CLIENT_IP_HEADER`. Source `apps/web/src/lib/public-access-api.ts` hiện yêu cầu header được cấu hình trong production. Không áp lại plan cũ; cần lập lại cấu hình theo luồng hiện tại và xác minh trusted ingress trước khi deploy.
- Việc cấu hình DNS/domain gửi OTP qua Resend là prerequisite vận hành đang mở ở #20; kiểm tra env readiness/runbook làm được, nhưng domain verification và gửi thư thực cần phạm vi triển khai riêng.

Không kết luận production-ready từ việc web local healthy; worker, email, ingress và restore là các kiểm chứng riêng.

## 5. Auto payout: phương án chuẩn bị tiếp

Task 39 hiện chỉ có config/readiness và `PayoutSender` port. `payoutReadiness()` luôn trả `enabled: false`; chưa có SDK ký, sender, `PayoutIntent` migration hoặc transaction thật.

Trước khi code sender, cần ghi rõ các quyết định đang mở trong requirements:

| Quyết định | Nội dung cần chốt |
| --- | --- |
| #26 | Đợt chạy/ngày hay chỉ test theo ngày, giờ và timezone, xử lý ngày bỏ lỡ. |
| #27–28 | Ngưỡng USD theo khoản/tổng ngày, phí; quote provider, tuổi báo giá và thời điểm khóa. |
| #29 | Asset sổ ví và chính sách nếu chuyển USDT sang coin gốc, phí và hạch toán. |
| #30 | Signer/worker và ví nguồn riêng theo môi trường. |
| #31 | Gas/finality, precision/base units, hạn mức/ngày, pause, insufficient funds và minimum/rent SOL. |
| #19/#32 | Điều kiện mainnet theo spec và kế hoạch test thực sau testnet; chưa được phê duyệt qua yêu cầu đổi UI. |

Sau khi chốt: requirements → design/state machine/idempotency → migration/contracts → sender adapters → mock integration nhiều ngày → testnet riêng → rà mainnet theo spec. Mock tests không broadcast; testnet/mainnet không thuộc đợt bàn giao Docker UI này.

## 6. Những việc không cần mở rộng lúc này

- Không tự đổi Cashback Hub sang tên mới (#22), thêm locale hoặc sàn ngoài phạm vi đang dùng.
- Task 10.9 normalized activity CSV chỉ khi một sàn không có export native phù hợp; không cần thêm fallback riêng cho MEXC hiện tại.
- Không triển khai SSE hay fact partitions để làm homepage trông bận rộn; ticker demo hiện vẫn có nhãn theo Req 17.

Nguồn đối chiếu: `.kiro/specs/cashback-platform/{requirements,design,tasks}.md`, `scripts/test-*.mjs`, `scripts/verify-postgres-backup.ps1`, `apps/web/src/lib/public-access-api.ts`, `packages/core/src/payout/{config,sender}.ts`. Trạng thái trong tài liệu là source/spec audit ngày 2026-10-14, không phải truy vấn Railway hoặc đối soát live exchange.
