# Phương án các phần còn lại sau Dark Aurora

Ngày rà soát: 2026-10-27. Phạm vi: thứ tự triển khai theo requirements/design/tasks; trạng thái UI và 5 lựa chọn cuộc họp theo `meeting-2026-10-20-implementation-plan.md`. Specs vẫn là nguồn sự thật; không tự đóng quyết định mở hoặc phê duyệt production/mainnet.

## 1. Trạng thái và thứ tự đề xuất

Dark Aurora/Task 43 đã có code calculator volume, lookup customer cashback và bỏ Wallet/rút public. Tiếp tục kiểm chứng theo kế hoạch Task 43; Task 40.5/43.4c vẫn cần browser visual QA. URL local chỉ được ghi là đang chạy sau khi kiểm tra stack healthy.

| Ưu tiên | Nhóm | Task/requirement | Có thể làm tiếp | Điều kiện trước khi kết luận hoàn thành |
| --- | --- | --- | --- | --- |
| 1 | Hoàn tất Task 43 và QA giao diện | 43.4/40.5; Req 8/14/19–20 | Core/lint/UID access, dọn tài liệu, sửa lỗi tái hiện; kế hoạch/evidence hiện hành có link ở đầu tài liệu | Browser QA 360–1440px, keyboard/contrast/reduced motion; DOM/HTTP không chứng minh layout. |
| 2 | Kiểm chứng luồng dữ liệu → tiền → ví | 18; Tasks 10/11/13/14/23/24/25 | Chạy lại integration hiện có bằng fixtures trong schema Docker riêng; sửa lỗi nếu tái hiện | Đủ bằng chứng idempotency, concurrency, corrections, release holds, OTP/session, reserve/cancel/approve/paid; không gửi email/coin thật. |
| 3 | Kiểm chứng connector activity | 20.5 và phần fixture của 20.6 | Fixture/unit/integration Bybit/MEXC/Binance, coverage, retry/429/lease/drift/raw load | Đối soát period/UID trên dữ liệu sàn thực trước live rollout. API activity không tự là commission thanh toán. |
| 4 | Vận hành và độ tin cậy | 19; Req 6.5/12 | Docker worker health/heartbeat/alerts, runbook, backup/restore vào DB Docker tạm | Kiểm chứng cấu hình triển khai hiện tại và quy trình restore; Railway cần yêu cầu riêng, không áp plan cấu hình cũ. |
| Chờ dữ liệu | Native import và MEXC payable commission | 10.2, 10.8, 11.1; Open decision #11 | Chuẩn bị checklist mapping/đối soát theo adapter framework đã có | Report commission UID-level có số khác 0, đơn vị, kỳ, settlement và identity; native Bybit cần sample thật. |
| Chờ quyết định | Auto payout ETH/BNB/SOL | Req 21; Task 39 | Hoàn thiện design/decision matrix và test scenarios theo spec | #19, #26–32: lịch, USD valuation, asset conversion, signer, phí/finality/limits và testnet. Sender hiện chưa có implementation. |
| Chưa cần | SSE / phân vùng facts | 21 / 29 | Giữ deferred theo task hiện tại | SSE chỉ khi có nhu cầu; Task 29 chỉ khi gần 5,000 UIDs/day hoặc có bằng chứng p95/scan theo task. |

Đề xuất bắt đầu nhóm **2** sau QA UI. Luồng tiền đã có implementation và scripts kiểm tra, nên ưu tiên xác nhận nó trước khi mở rộng payout/connector mới. Nhóm 3–4 dùng fixtures/Docker làm độc lập được, không cần bật schedule thật.

## 2. Đợt tiếp theo: kiểm chứng end-to-end trên Docker

### Chuẩn bị bộ chạy test

- Chỉ nhận `TEST_DATABASE_URL` rõ ràng, kiểm tra host Docker trước migrate/create schema; không fallback `DATABASE_URL`. `scripts/test-uid-access.mjs` đã bắt buộc host `postgres`; rà cùng quy tắc trước khi chạy các scripts khác.
- Mỗi integration dùng schema tên riêng, giữ dữ liệu public của localhost để người dùng tiếp tục xem. Cleanup có `finally`, chỉ xóa schema/fixtures do test tạo và kiểm tra kết quả dọn.
- Mock email transport, exchange fetch, RPC và signer; không lấy secret thật để test. `test-uid-access.mjs` hiện blank email credentials cho web con nên có thể đánh giá availability/auth mà không gửi thư thật.
- Build dependencies trong Docker và khớp schema migration trước test. Không chạy worker với `.env` thật/schedule đang bật để thay thế fixture test.

### Thứ tự scripts có sẵn

| Bộ kiểm tra | File | Bằng chứng cần giữ |
| --- | --- | --- |
| Import → publish → attribution → hold/withdraw | `scripts/test-bybit-integration.mjs` | Retry/corrections không credit trùng; publish fail rollback; race không double spend; cancel/release/audit đúng. |
| Lookup → UID session/private reads và retired money routes | `scripts/test-uid-access.mjs` | Opaque UID, public/private boundaries, rate limit phút/giờ, OTP/session; có/không session đều không tạo/hủy yêu cầu rút. |
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

**Cập nhật triển khai 2026-10-17:** #34–35 đã duyệt và code theo Task 42.1–42.2 đã có: migration `202610170001_customer_payables`, đồng bộ `CustomerPayable` theo release, đợt 23:00 UTC (gộp theo UID, ngưỡng ≤20/>20, tích lũy ≤0.5), approval chờ đợt kế tiếp, đối soát UNKNOWN, gate cutover, API và trang `/admin/payables`. Mô phỏng `scripts/test-payables.mjs` (19 nhóm) PASS trên Docker; xem `docs/specs/cashback-platform/payables-rtm.md` và `happy-path-scenarios.md` P1–P14. **Còn lại trước khi gửi tiền thật:** adapter MEXC/Bybit + xác minh tài khoản nguồn/quyền API/address book Bybit (`docs/exchange-uid-payout-research.md`), backfill + cutover production, gỡ nút rút của khách ở `/withdraw`, chốt tỷ lệ cashback và holding, kiểm các case NOT RUN trong RTM. Chưa chạy trên Railway và chưa deploy.


**Câu 1 đã chốt:** cả MEXC và Bybit trả USDT tới UID cùng sàn, một source account riêng mỗi sàn;
Binance nối sau khi đủ data/UID mapping và quyền kênh gửi. Khảo sát API/OTP/whitelist và giới hạn
bằng chứng: [exchange-uid-payout-research.md](exchange-uid-payout-research.md). Bybit cần recipient
address book; MEXC API không có OTP trong contract nhưng account thực chưa kiểm; Binance Pay
Merchant Payout là ứng viên, không phải chỉ thêm data là auto bật. Chưa cấp key/chưa chuyển tiền.

**Câu 2 đã chốt:** chấp nhận operator thêm/xác minh mỗi UID Bybit một lần; các lần trả sau tự động
khi đủ điều kiện. Chưa kiểm chứng quy trình trên tài khoản thực; yêu cầu xác minh lại vẫn là blocker.

**Câu 3 đã chốt:** mỗi ngày khởi chạy một đợt lúc **23:00 UTC (UTC+0)**; gộp các khoản cashback
đủ điều kiện của cùng sàn + UID + USDT thành một lệnh logic trong đợt. Tổng sau gộp dùng xét ngưỡng
<=20 USD theo câu 4; trên 20 USD cần approval, không chia nhỏ để né. Đồng bộ sổ vẫn async độc lập. Đây chưa chốt
grain/khóa nguồn/mapping #34; customer withdrawals/partial đã loại theo câu 13; cutoff 23:00 UTC đã chốt theo câu 8, retry lỗi chắc chắn chưa chuyển theo câu 9. Bỏ lỡ đợt xử lý theo câu 6.

**Câu 5 đã chốt:** khoản >20 USD approve sau đợt 23:00 UTC phải chờ đợt 23:00 UTC kế tiếp,
không gửi ngay. Trước giờ vẫn UNPAID + approval đã duyệt + WAITING_SCHEDULE; tới đợt kiểm lại
snapshot/approval/gates, không dùng approval cũ cho số tiền mới hoặc tạo thêm nghĩa vụ.

**Câu 6 đã chốt:** bỏ lỡ đợt thì chờ 23:00 UTC kế tiếp, gộp các khoản còn đủ điều kiện;
không tự chi bù lúc khôi phục. Sync/correction/đối soát vẫn phục hồi độc lập; UNKNOWN không gộp lại.

**Câu 7 đã chốt:** approved 25 USDT có thêm 5 USDT đủ điều kiện trước đợt kế tiếp → gộp 30 USDT,
vô hiệu approval cũ, UNPAID + AWAITING_APPROVAL và duyệt lại. Không trả riêng 25/dời 5 để né duyệt;
snapshot DISPATCHING/UNKNOWN/PAID được bảo toàn, xử lý theo đối soát thay vì sửa lệnh đã gửi.

**Câu 8 đã chốt:** chốt danh sách/tổng đợt lúc 23:00 UTC; cashback mới đủ điều kiện sau đó để
đợt ngày sau, không làm đổi snapshot/approval hiện tại chỉ do nguồn mới độc lập. Correction và
các gate ảnh hưởng phần tiền đã chốt vẫn phải kiểm trước gửi; không dùng cutoff để bỏ qua lỗi nguồn.

**Câu 9 đã chốt:** lỗi được xác nhận chắc chắn chưa chuyển tiền → giữ UNPAID, đợi đợt 23:00 UTC
ngày sau và xét lại mọi điều kiện. Job backoff/RETRY không gửi bù ngay; UNKNOWN giữ khóa và đối soát,
không tự retry khi sang ngày mới. Sync/ghi nhận kết quả/đối soát vẫn chạy ngoài lịch chi.

**Câu 10 đã chốt:** UID nhận lần đầu cũng tự trả nếu tổng <=20 USD và mọi gate đạt, theo lịch
23:00 UTC; >20 USD chờ duyệt. Bỏ mandatory first review trong spec đích; vẫn giữ onboarding/xác minh
UID của sàn, OTP/session cho private wallet/history reads và mọi gate khác. Runtime/tests legacy cần sửa ở Task 42.

**Câu 11 đã chốt:** operator chịu phí USDT nội bộ, khách nhận đủ principal cashback; phí hạch toán
riêng, không trừ payable/khách nhận hoặc cộng vào ngưỡng duyệt. Kiểm đủ nguồn cho tiền trả và phí;
thiếu/không rõ phí giữ UNPAID, không tự giảm tiền nhận. Phí thực tế/provider phải kiểm chứng; internal USDT chi theo nguồn thực theo câu 15, on-chain xử lý riêng.

**Câu 12 đã chốt:** xét ngưỡng internal USDT bằng quy ước 1 USDT = 1 USD: <=20 USDT có thể auto,
>20 USDT chờ duyệt. Không gọi/phụ thuộc market quote USDT/USD; audit lưu fixed policy/ratio/version,
không coi đây là giá thị trường hay conversion. Coin khác/on-chain vẫn có policy định giá riêng.

**Câu 13 đã chốt:** khách không yêu cầu rút toàn bộ/một phần hoặc hủy; chỉ tự trả theo lịch,
không cần bound email/OTP/session khách. Lookup/private wallet/history giữ phân quyền đọc; admin
duyệt/đối soát qua sổ chung. Cutover chặn customer money APIs/jobs/UI cũ và bảo toàn legacy reserved/UNKNOWN.

**Câu 14 đã chốt:** tổng principal phải **>0.5 USDT** mới xét trả; đúng 0.5 hoặc thấp hơn giữ UNPAID
để tích lũy, không mất nợ. Khoảng auto là >0.5 đến <=20 USDT khi đủ gate, >20 cần duyệt; vẫn theo
minimum/precision thực tế của sàn. Phí operator nằm ngoài principal, không làm tròn để vượt minimum.

**Câu 15 đã chốt:** không daily cap riêng cho USDT nội bộ, chi theo số dư tài khoản nguồn đủ
principal+phí và trừ cam kết/in-flight hợp lệ. Nạp 100 USDT chỉ là ví dụ; thiếu nguồn giữ UNPAID
đợi 23:00 UTC ngày sau, không giảm khoản trả hoặc gửi bù ngay khi top-up. Skip nhóm thiếu nguồn theo câu 16; priority ban đầu còn mở.

**Câu 16 đã chốt:** skip UID thiếu funds sang đợt ngày sau, vẫn xét UID phía sau nếu đủ cả
principal+phí; không dừng toàn đợt, không trả một phần hoặc thử lại UID bị skip cùng đợt.
Thứ tự ưu tiên ban đầu giữa các UID còn cần chốt; không mặc định sort số tiền nhỏ nhất.

**Bổ sung business ngày 2026-10-17:** Req 22 / Task 42.0 đã đặc tả sổ khoản phải trả
`CustomerPayable`: một bảng chính lưu sàn/UID/tài sản/số tiền/nguồn và lịch sử PAID/UNPAID.
Khoản chờ approval/lỗi/đang xử lý/chưa rõ kết quả vẫn UNPAID với lý do riêng; PAID cần
bằng chứng chuyển thành công và settle đúng một lần. Đây chưa phải model/migration đã triển khai.
#33 đã chốt và Task 42.0a đã đặc tả: ingest/publish → commission/cashback hợp lệ →
release hold/correction → job đồng bộ CustomerPayable, hoàn toàn async; không chờ khách rút.
Mọi auto/manual/approval/retry/đối soát/mark-paid phải dựa trên payableId/version qua command
async chung (API nhận 202, worker xử lý), không có đường chi độc lập từ Wallet/raw/activity.
Enqueue cùng transaction nguồn, lease/idempotency/checkpoint/catch-up bảo vệ đồng bộ;
phần tiền có nguồn mới chưa đồng bộ phải chặn chi mới, nhưng vẫn ghi nhận kết quả đã chuyển.
Chốt #34 cách gom kỳ/phân bổ/correction và #35 mapping/quyền kênh trước 42.2; phương án
release/FIFO allocations trong design chưa phải business được duyệt. Ngưỡng Req 9/21/22 thống nhất
<=20 USD trên tổng execution theo câu 4; >20 USD giữ UNPAID + AWAITING_APPROVAL. Câu 13 bỏ customer withdrawal/partial; còn review grain/khóa nguồn/mapping.
Hủy chỉ trước DISPATCHING, chi thừa sau ranh giới dùng recovery 8.7.
Cutover bắt buộc 42.3a–e: gate mọi writer → FROZEN → backfill/reconcile → legacy alias → PAYABLE_ONLY,
không reserve/settle lại hoặc fallback handler cũ. RTM/GWT: `payables-rtm.md`, mọi test còn NOT RUN;
đây là bổ sung truy vết nội bộ, không tự áp chuẩn FSS. Sync lỗi không giấu nợ; nguồn chưa sync có
counter/alert riêng. Đồng bộ sổ và lịch chi độc lập; code/DB vẫn chưa đổi.
Nguồn nghiệp vụ: `docs/specs/cashback-platform/requirements.md` → Requirement 22;
thiết kế và scenarios tương ứng ở `design.md`. Req 21 về on-chain vẫn giữ riêng.

Task 39 hiện chỉ có config/readiness và `PayoutSender` port. `payoutReadiness()` luôn trả `enabled: false`; chưa có SDK ký, sender, `PayoutIntent` migration hoặc transaction thật.

Trước khi code sender, cần ghi rõ các quyết định đang mở trong requirements:

| Quyết định | Nội dung cần chốt |
| --- | --- |
| #26 | USDT nội bộ một đợt/ngày 23:00 UTC; approve sau đợt/bỏ lỡ đều chờ đợt kế tiếp. Câu 8 chốt cutoff 23:00 UTC; câu 9 lỗi chắc chắn chưa chuyển chờ đợt ngày sau. Lịch on-chain riêng chưa chốt. |
| #27–28 | Đã chốt ngưỡng <=20 USD trên tổng principal, operator chịu phí USDT nội bộ; câu 12 chốt fixed 1:1/20 USDT nội bộ không cần quote. Câu 15 không daily cap USDT nội bộ, chi theo nguồn đủ tiền/phí; câu 16 skip nhóm thiếu funds, còn priority ban đầu và kiểm chứng provider. Quote provider/tuổi báo giá/khóa cho tài sản khác. |
| #29 | Asset sổ ví và chính sách nếu chuyển USDT sang coin gốc, phí và hạch toán. |
| #30 | Signer/worker và ví nguồn riêng theo môi trường. |
| #31 | Gas/finality, precision/base units, hạn mức/ngày, pause, insufficient funds và minimum/rent SOL. |
| #19/#32 | Điều kiện mainnet theo spec và kế hoạch test thực sau testnet; chưa được phê duyệt qua yêu cầu đổi UI. |

Sau khi chốt: requirements → design/state machine/idempotency → migration/contracts → sender adapters → mock integration nhiều ngày → testnet riêng → rà mainnet theo spec. Mock tests không broadcast; testnet/mainnet không thuộc đợt bàn giao Docker UI này.

## 6. Những việc không cần mở rộng lúc này

- Không tự đổi Cashback Hub sang tên mới (#22), thêm locale hoặc sàn ngoài phạm vi đang dùng.
- Task 10.9 normalized activity CSV chỉ khi một sàn không có export native phù hợp; không cần thêm fallback riêng cho MEXC hiện tại.
- Không triển khai SSE hay fact partitions để làm homepage trông bận rộn; ticker demo hiện vẫn có nhãn theo Req 17.

Nguồn đối chiếu: `docs/specs/cashback-platform/{requirements,design,tasks}.md`, `scripts/test-*.mjs`, `scripts/verify-postgres-backup.ps1`, `apps/web/src/lib/public-access-api.ts`, `packages/core/src/payout/{config,sender}.ts`. Trạng thái trong tài liệu là source/spec audit ngày 2026-10-14, không phải truy vấn Railway hoặc đối soát live exchange.
