# RTM và test scenarios — CustomerPayable (Req 22)

Ngày: 2026-10-17. Nguồn nghiệp vụ: requirements.md, Req 9/12/21/22; thiết kế: design.md → Phân bổ release, Ranh giới gửi/blockers, Cutover. Tài liệu này là kế hoạch kiểm chứng và truy vết, không tự thêm policy hoặc chứng nhận một tiêu chuẩn FSS chưa được cung cấp.

**Trạng thái (cập nhật 2026-10-17): PARTIAL.** Migration `202610170001_customer_payables` và core đã có; mô phỏng chạy bằng `scripts/test-payables.mjs` (19 nhóm C1–C19, exchange giả `SimulatedInternalTransfer`, Docker Postgres, schema riêng, không gửi tiền thật) — xem bảng "Evidence đã chạy" ngay dưới. Các case ghi NOT RUN/PARTIAL chưa có bằng chứng. Với các case còn lại, chạy integration trên Docker Postgres theo steering, schema/fixtures riêng, clock/transport/quote giả lập, không gửi tiền thật. Evidence khi thực thi phải có commit, test ID, command, expected/actual, kết quả, log assertions, migration version; không lưu secret/UID khách thật. Không đánh dấu Task 42.4 xong từ việc có RTM.

**Applicability:** #34–35 còn mở. Customer withdrawal/partial đã loại theo câu 13. Partial trong các case nguồn chỉ còn là legacy/provider discrepancy, không phải quyền khách chọn amount. Các ví dụ sourceRelease/FIFO/constraints cụ thể trong PAY-009/010/014/021/025/026/033 là kiểm chứng phương án nếu được chọn, không phải business đã duyệt; khi chọn phương án khác phải cập nhật các case đó trước code. PAY-021 kiểm gate chưa duyệt là bắt buộc ngay trong kế hoạch; không chạy test theo một grain chưa được chọn.

## Evidence đã chạy (2026-10-17, mô phỏng)

Lệnh: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/railway node scripts/test-payables.mjs` → `19 scenario groups passed`. Môi trường: Docker Postgres 18.6, schema `cashback_test_*` tự tạo/xóa, migration chạy `prisma migrate deploy` đủ 202610170001. Kiểm tra mutation: tắt lớp chặn execution in-flight trong `prepareGroup` làm C9 fail, bật lại thì qua. Hồi quy: `scripts/test-bybit-integration.mjs` (luồng LEGACY, hooks cashback.ts) qua; `packages/core` 45 test qua. **Giới hạn:** exchange là test double; chưa có adapter MEXC/Bybit thật, chưa chạy worker loop thật, chưa chạy trên Railway.

| Kết quả | Test ID | Scenario chứng minh |
| --- | --- | --- |
| PASS (mô phỏng) | PAY-003, 006, 008, 009, 010, 014, 016, 019, 025, 027, 029, 037, 038, 039, 040, 041, 042, 044, 045, 046, 047, 049 | C1–C17 (xem ghi chú từng nhóm trong script) |
| PARTIAL | PAY-002, 004, 005, 007, 011, 012, 013, 015, 017, 018, 021, 022, 023, 024, 031, 032, 035, 036, 043, 048 | Phần chính có scenario; còn thiếu: biến thể asset/đích của PAY-005, RETRY command (không triển khai: retry là đợt kế tiếp), authz API admin/UID (PAY-013), crash giữa commit/ACK (PAY-017), hai thứ tự race CAS (PAY-022), backfill/mapping legacy (PAY-024), instance cũ/worker thật (PAY-032/035), tài khoản sàn thật (PAY-036) |
| NOT RUN | PAY-001, 020, 026, 028, 030, 033, 034 | UID `00123` vs `123` trên payable, response activity thiếu UID, delta credit sau PAID, cancel vs CAS race, lease hết sau DISPATCHING, settle vs release race, command nhận sau đổi gate |

## Ma trận acceptance criterion → Given–When–Then

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-001 | 22.1; 5.2 | UID chuỗi `00123`, `123` cùng sàn và `00123` sàn khác theo contract hợp lệ | Ingest và sync | Giữ UID opaque/số 0; ba subject khác nhau theo 5.2; khoản lưu source/kỳ/asset/account đúng. Đây là regression policy đã có, không phải thêm chuẩn hóa mới. |
| PAY-002 | 22.2 | Activity có volume/REPORTED_COMMISSION, demo và pending chưa release; một commission hợp lệ đã release | Sync toàn bộ | Chỉ source release hợp lệ tạo payable; các nguồn còn lại không tạo khoản sẵn sàng chi hoặc tăng Wallet. |
| PAY-003 | 22.3 | Một payable mới, command approve và response provider accepted | Worker lần lượt tiếp nhận/duyệt/gửi | Vẫn UNPAID; không có settlement/paidAt trước xác nhận thực tế. |
| PAY-004 | 22.4 | Một khoản vừa cần approval vừa thiếu funds | Refresh dữ liệu UI/API | Trả đầy đủ blockers và tiến trình; không chỉ lưu một lý do làm mất lý do còn lại. |
| PAY-005 | 22.5 | Admin có quyền đã duyệt snapshot amount/asset/destination/version | Sửa từng thành phần qua luồng hợp lệ rồi SEND | Approval cũ mất hiệu lực, version tăng, chặn gửi; audit có actor/thời điểm/snapshot cũ và mới. |
| PAY-006 | 22.6; 9.5; 21.3 | UID lần đầu và UID đã nhận tiền, các điều kiện khác đầy đủ; valuation tạo tổng execution 19.99/20/20.01 USD (internal USDT fixed 1:1); nhánh coin khác thiếu/stale quote | Auto-approval và dispatch cho từng execution | 19.99 và đúng 20 đủ điều kiện tự duyệt/chi; 20.01 giữ UNPAID + AWAITING_APPROVAL, không gọi sender trước duyệt; thiếu/stale quote chỉ chặn nhánh cần market valuation, không chặn internal USDT fixed 1:1. Tổng nhiều allocations được xét chung, không theo ngưỡng asset; scheduler không chia để né duyệt. NOT RUN. |
| PAY-007 | 22.7 | Execution lỗi chắc chắn chưa gửi, allocations đã RELEASED có bằng chứng | Retry command/job và một RETRY mới hợp lệ | Cùng commandKey trả execution cũ; RETRY mới có successor liên kết nhưng cùng payable; không tăng entitlement hoặc nhân nghĩa vụ. |
| PAY-008 | 22.8 | Execution DISPATCHING sau timeout, provider outcome chưa rõ | Cancel, release và SEND/RETRY mới | Tất cả thao tác chi/hoàn mới bị chặn; R/reserved giữ nguyên; RECONCILE được phép và có audit. |
| PAY-009 | 22.9 | Snapshot 15 có receipt đầy đủ hoặc provider báo chỉ nhận5 | Xác nhận lặp/đối soát | Đầy đủ settle một lần; receipt thiếu giữ UNPAID/exception và bảo toàn phần thiếu10, không tự PAID15 hoặc tự gửi bù. Đây không phải khách chọn rút một phần. |
| PAY-010 | 22.10; 22.35 | Wallet available15, release15; sync/replica/admin và customer request5 cạnh tranh | Claim cùng nhóm15 và gọi customer route | Customer bị từ chối không reserve/job; sync không reserve; một execution hợp lệ thắng lock, không R>15/available âm hoặc cộng payable vào Wallet. |
| PAY-011 | 22.11 | UNPAID còn quyền hưởng10, lệnh chưa dispatch; một khoản PAID | Cancel/reject lệnh; đóng không có nguồn; correction về0 hoặc kế thừa theo #34 đã duyệt; sửa PAID | Không mất quyền hưởng; đóng vô căn cứ/sửa PAID bị từ chối. Đóng hợp lệ cần dư0 hoặc successor nhận đủ quyền hưởng trong cùng transaction, links/audit và không in-flight; cơ chế cụ thể chờ #34. |
| PAY-012 | 22.12 | UNPAID READY/approval/partial/SYNC_FAILED/UNKNOWN và nguồn FAILED chưa có payable | Mở view mặc định, đổi lọc sàn/UID | Không giấu dòng nợ dương; banner/counter/alert vẫn có nguồn chưa sync ngoài filter; tổng chưa xác định không thành 0; sums theo asset, history có PAID/closed-zero. |
| PAY-013 | 22.13 | Admin và anonymous; request tới private customer API đã gỡ; lỗi transport chứa secret giả | Đọc bảng/command/history, approval/reconcile/settle và log | Chỉ admin có quyền xem lịch sử chi; API riêng tư khách không hoạt động, anonymous không được xem history hoặc command. Audit đủ, không lộ secret/private key/lịch sử chi qua lookup; totalPaid tổng hợp vẫn công khai. Cần kiểm lại theo Task 44.4. |
| PAY-014 | 22.14 | Grain/khóa nguồn đã được duyệt ở #34; nhiều job duplicate và provider ref đã dùng | Chèn trùng payable/phân bổ/settlement/ref cạnh tranh | Constraints DB theo grain đã duyệt chặn trùng, rollback nguyên tử, một effect/ref; nếu chọn release thì kiểm composite key/partial index ở design; chưa duyệt khóa là gate chặn migration. |
| PAY-015 | 22.15; 22.35 | Cùng scope, auto/admin/legacy admin và customer requests, payload sửa amount/UID | Gửi commands | Auto/admin resolve cùng payable/version/allocations; customer create/cancel/partial bị từ chối không mutation/job. Không có đường chi Wallet/raw hoặc đổi đích ngoài snapshot. |
| PAY-016 | 22.16 | File/API publish hợp lệ, credit pending, không có request rút | Ingest, đợi release theo clock và phát correction | Ingest không gọi sender; pipeline async sinh/update payable sau đủ điều kiện, release vẫn trigger khi không có lượt ingest mới. |
| PAY-017 | 22.17; 12.7 | Transaction nguồn + enqueue; worker có lease | Crash trước commit, sau commit/trước consume và sau effect/trước ACK | Trước commit rollback cả nguồn/job; sau commit job vẫn bền vững, retry không nhân effect; stale lease không commit. |
| PAY-018 | 22.18 | sourceVersion=3, applied=2, có job cũ v1 và command SEND | Chạy v1, SEND, rồi sync v3; đồng thời có callback của execution đã gửi | v1 không overwrite; chặn chi mới khi chưa current; sync bắt kịp; callback vẫn settle snapshot đã gửi, correction không ghi đè PAID. |
| PAY-019 | 22.19 | commandKey chưa dùng, worker tạm dừng; request cùng key cùng/khác payload và key khác cùng payable | Gọi API rồi chạy worker cạnh tranh | 202 + commandId chưa đổi PAID/approval; cùng key cùng payload trả ID cũ, khác payload trả conflict; một claim thắng, version cũ bị reject; kết quả chỉ hiện sau commit. |
| PAY-020 | 22.20 | Payable active/PAID, response activity thiếu UID và correction xác thực riêng | Sync lại, retry và correction | Missing UID/lỗi không xóa nghĩa vụ; retry không tạo payable thay thế; correction có nguồn và lịch sử, approval invalidation đúng; PAID bất biến. |
| PAY-021 | 22.21 | #34 hoặc #35 chưa được duyệt | Chuẩn bị migration/producer/writer mới | Bị chặn ở 42.1, không tự triển khai phương án. Nếu chọn release/FIFO: kiểm auto/admin/replica claim cùng nguồn, và legacy reserved/in-flight ở cutover; không reserve lại hoặc mất phần còn lại. Customer requests bị từ chối theo 22.35. |
| PAY-022 | 22.22 | PREPARED snapshot v2, correction v3 sẵn sàng commit | Chạy correction thắng lock trước CAS; chạy lại với CAS thắng trước correction | Trước CAS: INVALIDATED, không gọi sender, apply net/release/approval mới. Sau CAS: pendingCorrection/UNKNOWN guard, không hủy/hoàn/gửi lại; nếu thành công chi thừa ghi recovery, nếu proven-not-sent áp correction trước release. |
| PAY-023 | 22.23 | Nhiều blockers cùng lúc theo các priority, chưa in-flight | APPROVE, SEND, bổ sung funds, RETRY và refresh UI | PrimaryReason ổn định; APPROVE không xóa funds blocker; SEND chỉ khi blocker set rỗng, từng action theo policy table; in-flight chỉ reconcile/result. |
| PAY-024 | 22.24 | Old writer/route + jobs cũ + legacy reserved/paid/UNKNOWN, gate LEGACY | Chạy đầy đủ cutover FROZEN → backfill/map → PAYABLE_ONLY | Không dispatch mới trong freeze, reconcile-only có evidence; không reserve/settle lại; mapping unique/coverage khớp; old route không fallback; scope UNKNOWN blocked; rollback chỉ FROZEN. |
| PAY-036 | 22.25 | MEXC/Bybit có source riêng khác affiliate root; một recipient cần setup/verification; Binance mới chỉ có data | Preflight và command trên từng sàn; đổi source/key khi một lệnh UNKNOWN | Bind đúng source/recipient USDT, key đọc không có quyền send; recipient chưa sẵn sàng giữ UNPAID + blocker, không lấy OTP hoặc tắt bảo vệ. UNKNOWN giữ nguồn/snapshot để reconcile; Binance không tự send nếu chưa có Payout quyền/mapping. Chỉ mock, tài khoản thực chưa kiểm. |
| PAY-037 | 22.26; 9.5; 21.3 | Fake clock/server timezone khác UTC, cùng UID có các khoản đủ điều kiện 3+5+7 USDT; nhóm khác tổng 20/25 USD, khác sàn/UID; PAID/reserved/UNKNOWN | Tick trước/tại 23:00 UTC, chạy lặp và nhiều replica, thêm nguồn khi đợt đang chạy, tick ngày kế tiếp | Một đợt/ngày UTC và một execution logic/nhóm; nhóm đầu tổng 15 và nhóm đúng 20 có thể tự trả khi đủ gate, nhóm 25 giữ UNPAID chờ duyệt, không tách né ngưỡng; không trộn sàn/UID hoặc tiền PAID/reserved/UNKNOWN. Duplicate resolve cùng command, không send thêm do source mới; sync sổ vẫn chạy ngoài giờ. Bỏ lỡ đợt chờ lịch kế theo 22.28; cutoff 23:00 UTC theo 22.30, retry lỗi chắc chắn chưa chuyển chờ đợt ngày sau theo 22.31. NOT RUN. |
| PAY-038 | 22.27; 22.5; 22.20 | Khoản 25 USD chờ duyệt, đợt ngày D đã chạy; fake clock D 23:05 UTC, snapshot current | Approve, gọi SEND/job trùng trước giờ; tick D+1 23:00; lặp với snapshot đổi hoặc thiếu funds/UNKNOWN | Approve không gọi sender; giữ UNPAID + approved + WAITING_SCHEDULE, earliest slot D+1 23:00. Trước slot không dispatch; tới slot chỉ chi một lần khi snapshot/approval/gates hợp lệ, không tạo nghĩa vụ thứ hai. Snapshot đổi không dùng approval cũ; funds blocker giữ UNPAID, UNKNOWN chỉ đối soát. NOT RUN. |

Bổ sung PAY-036 theo câu 2: Given UID Bybit chưa thiết lập → giữ UNPAID + RECIPIENT_SETUP_REQUIRED; When operator hoàn tất thêm/xác minh và preflight xác nhận sẵn sàng → các lần chi sau đủ policy được tự động qua command chung, không bắt thiết lập lại từng lần. Nếu provider yêu cầu xác minh lại thì chặn theo Req 22.25. Trạng thái vẫn NOT RUN.

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-039 | 22.28; 22.6; 22.26–27 | Bỏ lỡ đợt D 23:00 UTC, recovery D+1 01:00; nợ chắc chắn chưa gửi 15 USD, thêm nguồn 10 USD; scope khác UNKNOWN/PAID | Recovery sync/reconcile và redeliver stale payout job; tick D+1 23:00 với nhiều replica | 01:00 không dispatch bù, giữ UNPAID/nguồn + WAITING_SCHEDULE; sync và reconcile vẫn chạy. 23:00 gộp phần đủ điều kiện, tổng 25 cần approval đúng snapshot, không dùng approval 15 cũ; không gộp UNKNOWN/PAID, không nhân nợ hoặc gửi trùng. Cutoff theo 22.30; retry lỗi chắc chắn chưa chuyển theo 22.31. NOT RUN. |

## Cases bổ sung cho các race và đường lỗi

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-049 | 22.38; 22.10; 22.33; 22.37 | Source còn3 USDT, thứ tự fixture nhóm5 rồi2, phí giả lập0.1; biến thể fee khiến nhóm2 không đủ; UNKNOWN commitments và replica | Chạy đợt, retry jobs/top-up cùng đợt, chạy đợt ngày sau | Nhóm5 UNPAID/INSUFFICIENT_SOURCE_FUNDS defer tới ngày sau, nhóm2 được xét tiếp và chỉ gửi nếu đủ2+fee sau cam kết. Không partial pay, fail-fast toàn đợt, revisit nhóm defer hoặc trả trùng; khi không đủ2+fee giữ UNPAID. UNKNOWN không thành free balance. Fixture order không tự chốt business priority. NOT RUN. |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-048 | 22.37; 22.10; 22.31; 22.33 | Source balance100 rồi200, không daily cap; nhiều UID <=20 mỗi nhóm, phí/UNKNOWN commitments; funding race nhiều replica | Claim/send đồng thời, funds không đủ nhóm tiếp theo, top-up và job retry trước lịch ngày sau | Không cap100 giả; không chi quá nguồn sau principal+phí/cam kết, không dùng trùng source. Nhóm thiếu funds UNPAID + INSUFFICIENT_SOURCE_FUNDS chờ D+1 23:00, không partial pay hoặc auto gửi bù do top-up. Đợt sau xét lại tổng/approval/gates; UNKNOWN chỉ reconcile, không coi là free. Skip nhóm thiếu nguồn theo 22.38; priority ban đầu còn mở. NOT RUN. |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-047 | 22.36; 22.6; 22.30; 22.33–34 | Tổng principal 0/0.49/0.5/0.51/20/20.01 USDT, mọi gate khác đạt; provider minimum giả lập1 và fee operator; thêm nguồn trước/sau cutoff | Chạy lịch nhiều ngày và duplicate jobs | 0 không gửi/không tạo nghĩa vụ 0; số dương <=0.5 UNPAID tích lũy/lý do rõ, không xóa/nhân nợ; 0.51/20 có thể auto nếu provider cho phép; 20.01 chờ duyệt. Provider min1 chặn 0.51 dù thỏa business minimum. Không round-up/cộng fee để vượt mức; nguồn sau cutoff ngày sau, không trả lại PAID/UNKNOWN. NOT RUN. |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-046 | 22.35; 9.1–9.11; 20.4; 22.24; 14 | UID có cashback hợp lệ, recipient ready; request cũ có/không cookie; legacy reserved/UNKNOWN | Tick 23:00, lookup public, gọi old create/cancel và kiểm route riêng tư đã gỡ | Auto xét chi về UID không phụ thuộc xác thực khách; recipient/gates vẫn kiểm. Khách chỉ lookup công khai; không email binding, phiên UID, ví riêng hoặc tự rút; /withdraw redirect /#lookup, POST tạo/hủy cũ trả 410 không reserve/job; không public hóa history cũ. Admin queue legacy/payables giữ nguyên. Legacy UNKNOWN đối soát, không xóa hoặc trả trùng, không old-job bypass. NOT RUN cho target 30/10 (Task 44.4). |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-045 | 22.34; 22.6; 22.33 | Internal USDT tổng 19.99/20/20.01, policy fixed 1:1; quote feed lỗi hoặc trả giá khác 1; phí operator; biến thể coin khác không có quote | Xét ngưỡng/snapshot và preflight ở lịch hợp lệ | USDT không gọi/phụ thuộc quote feed, 19.99/20 có thể auto khi mọi gate đạt, 20.01 chờ duyệt; audit mode/ratio/version rõ, phí ngoài principal. Coin khác không tự áp 1:1 hoặc vượt quote gate. Source freshness/readiness/limits vẫn chặn khi sai. NOT RUN. |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-044 | 22.33; 22.6; 22.9 | Principal 15/20 USDT, phí giả lập 0.1 USDT operator chịu; biến thể nguồn chỉ đủ principal, phí asset khác, fee chưa rõ hoặc provider net thiếu | Preflight, send và reconcile theo mock fee semantics | Khách nhận đủ principal; nguồn cần principal+phí theo asset, payable/ngưỡng không bị cộng/trừ phí và không có customer receivable do phí. Thiếu funds/fee readiness thì UNPAID, không giảm tiền nhận. Receipt thiếu không PAID toàn khoản/không tự gửi bù; phí audit riêng, settle cashback một lần. NOT RUN. |

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-043 | 22.32; 9.5; 15.9; 22.25 | UID nhận lần đầu, tổng định giá 19.99/20/20.01 USD; biến thể Bybit chưa setup, receivable, phí chưa rõ, ngoài lịch | Auto-approval/dispatch và job lặp | 19.99/20 có thể tự trả khi mọi gate đạt; 20.01 UNPAID chờ duyệt. Không có FIRST_REVIEW_REQUIRED. Thiếu setup hoặc có receivable/phí chưa rõ/ngoài lịch vẫn chặn, không tự verified recipient; không gửi/settle trùng. NOT RUN. |

Câu 8 bổ sung PAY-041: trường hợp nguồn mới sau cutoff độc lập không được hiểu là correction của nguồn đang nằm trong snapshot; cả hai đường phải được kiểm riêng.

| Test ID | AC | Given | When | Then / assertion bắt buộc |
| --- | --- | --- | --- | --- |
| PAY-025 | 22.21–22.22 | Release 15, S=0,R=5, correction giảm entitlement còn 3 | Correction trước/sau DISPATCHING | Trước: invalidate execution, apply target 3 trước mở free; sau: giữ T/R tới reconcile, nếu paid5 thì recovery 2 có liên kết, không available âm hoặc trả thêm 10. |
| PAY-042 | 22.31; 12.5; 22.8 | Đợt D chuyển lỗi có evidence chắc chắn chưa gửi; job backoff/RETRY lặp; biến thể chỉ timeout/UNKNOWN | Recovery/RETRY trước đợt D+1, tick D+1 23:00 và thêm nguồn làm đổi tổng/approval | Proven-not-sent vẫn UNPAID, trước slot không sender; đợt ngày sau xét lại cutoff/total/approval/gates, cùng nghĩa vụ, không reuse allocation terminal hoặc chi trùng. UNKNOWN giữ khóa/reconcile kể cả sang ngày mới, không tự retry. Ghi outcome/sync/reconcile ngoài giờ vẫn được phép. NOT RUN. |
| PAY-041 | 22.30; 22.18; 22.22; 22.29 | Approved 25 USDT, manifest cutoff D 23:00 UTC; nguồn độc lập 5 đủ điều kiện 23:01; worker UID chạy trễ | Sync nguồn mới/replay manifest; đối chiếu với release 5 trước cutoff và correction ảnh hưởng manifest trước/sau DISPATCHING | Nguồn 23:01 để đợt sau, snapshot 25/approval không đổi chỉ vì nguồn mới ngoài manifest, không tạo lệnh bổ sung. Nguồn trước cutoff gộp 30/duyệt lại. Correction trước dispatch invalidate/chặn; sau dispatch giữ snapshot/reconcile. Manifest thiếu freshness không gửi; nguồn không được phân bổ hai đợt, replica dùng cùng danh sách. NOT RUN. |
| PAY-040 | 22.29; 22.5; 22.22 | Approved tổng 25 USDT chưa gửi; trước đợt kế tiếp có release mới 5, source identity ổn định | Sync/job lặp, APPROVE version cũ và SEND cũ chạy race; lặp với DISPATCHING/UNKNOWN | Tổng chưa gửi 30, approval 25 vô hiệu và giữ audit; UNPAID + AWAITING_APPROVAL, không gửi riêng 25/dời 5 để né duyệt lại. Sync không nhân nguồn, CAS approval/send stale bị từ chối; duyệt lại đúng 30 vẫn theo lịch. DISPATCHING/UNKNOWN không bị sửa snapshot hay gửi lại, áp reconcile/source mới theo 22.18/20/22. NOT RUN. |
| PAY-026 | 22.11; 22.20–22.21 | Payable PAID15 có correction tăng quyền hưởng thêm 2 đã qua holding | Publish delta credit/release thật rồi retry sync | Khoản PAID15 bất biến; đúng một release/payable delta2 mới được tạo và link correction; retry không tạo bản thứ ba. |
| PAY-027 | 9.5; 15.9; 22.5–22.6; 22.32 | UID chưa từng trả hoặc chỉ có request hủy/reject; khoản mới 5 USD, mọi gate đạt | Auto-approve tại đợt đủ điều kiện | Có thể tự duyệt/chi dù chưa có initial review, không tạo FIRST_REVIEW_REQUIRED; vẫn kiểm quyền nhận/readiness/lịch và chống trùng. NOT RUN. |
| PAY-028 | 9.10; 22.8; 22.22 | PREPARED, admin CANCEL và DISPATCH CAS cùng chạy | Đảo thứ tự lock thắng | CANCEL thắng: không sender; CAS thắng: cancel bị chặn, không release. Không có vừa refund vừa transfer. |
| PAY-029 | 22.9; 22.14 | Manual execution đã claim5; receipt sai amount/asset/đích, ref trùng execution khác, hoặc provider chỉ trả2 | Mark-paid/reconcile | Không settle toàn5/PAID; UNKNOWN/exception có audit, không tự gửi bù; ref trùng bị conflict DB. |
| PAY-030 | 22.17–22.19 | Job lease hết sau DISPATCHING; replica mới nhận lại; provider không có idempotency đáng tin | Job retry | Không tạo/call sender lần hai; UNKNOWN + alert, reconcile xác định outcome trước successor; không dựa vào NOT_FOUND đơn lẻ. |
| PAY-031 | 22.18; 22.20 | Scope A FAILED chưa có khoản, scope B current và độc lập | Lọc chỉ B, chạy command B | Banner vẫn báo A chưa sync; không báo global complete; B chỉ bị khóa nếu thực sự chung scope tài chính bị ảnh hưởng. |
| PAY-032 | 22.24 | Gate missing/FROZEN, instance cũ không hỗ trợ, legacy mapping thiếu | Gọi tất cả routes/scheduler/job money mutation trong inventory | Missing/FROZEN fail closed; instance không guard phải loại khỏi cutover trước mở gate; mapping thiếu 409/503, không ghi legacy. |
| PAY-033 | 22.14; 22.21 | Allocation ACTIVE5; hai transactions SETTLE và RELEASE cạnh tranh | Chạy đồng thời | Chỉ một terminal transition/ledger effect; không có cả release và settle cho cùng allocation, Wallet/S/R/audit nguyên tử. |
| PAY-034 | 22.23; 22.24 | Blockers + manual approval + gate FROZEN; command đã enqueue từ LEGACY | Worker nhận command sau đổi gate | Đọc lại gate trong mutation transaction, không approve/claim/dispatch mới; chỉ reconcile-only được phép với execution đã gửi và evidence. |
| PAY-035 | 12.7; 22.16–22.17 | Schema/consumer cũ và producers job mới tắt | Deploy enum/handlers rồi producer theo thứ tự và kiểm migration | JobType đích gồm SYNC_PAYABLES/PAYABLE_COMMAND; không enqueue trước consumer tương thích, job cũ PARSE vẫn decode; chưa dùng enum runtime cũ để chứng minh spec mới đã chạy. |

## Đánh giá lại findings theo toàn bộ spec → phần cần làm rõ → tests

| Finding theo bảng đánh giá lại | Kết luận / phần xử lý | Tests |
| --- | --- | --- |
| 1 Giữ tiền hai lần | Khoảng thiết kế đã được ghi nhận ở #34, gate 42.2, không phải lỗi bỏ sót. Có phương án để review, chưa coi đã giải quyết bằng implementation. | PAY-010, PAY-021, PAY-025, PAY-033 |
| 2 Ngưỡng/hủy | Mâu thuẫn đã được ghi nhận đầu Req9; câu 4 thống nhất `<=20 USD` tự trả khi đủ gate, `>20 USD` chờ duyệt; hủy pre-DISPATCHING. | PAY-006, PAY-027, PAY-028 |
| 3 Snapshot/correction | Đã có settle snapshot + reconcile chênh lệch; bổ sung rõ pre-dispatch invalidation và đường receivable/clawback 8.7, không coi trước đây hoàn toàn thiếu. | PAY-018, PAY-022, PAY-025, PAY-030 |
| 4 Đóng UNPAID | 22.20 chỉ cấm successor né khóa, không cấm successor hợp lệ. Cơ chế phân bổ/kế thừa vẫn #34; thêm điều kiện không mất quyền hưởng. | PAY-011, PAY-020, PAY-026 |
| 5 View che nợ | Finding yếu: UNPAID active lỗi sync vốn vẫn hiện, đã có lastAppliedAt/backlog. Làm rõ thêm nguồn chưa có payable/counters; không coi là lỗi hiển thị đã chứng minh. | PAY-012, PAY-031 |
| 6 Legacy route | Đã có alias/reject rule, thiếu thứ tự cutover; bổ sung chi tiết nhẹ 22.24/42.3a–e. | PAY-024, PAY-032, PAY-034 |
| 7 Dedup/UID | Khóa payable chờ #34 là gate hợp lệ; UID policy đã có ở 5.2 nên phần nói thiếu chuẩn hóa là sai. | PAY-001, PAY-014, PAY-017 |
| 8 RTM | Repo đã có `_Requirements: N.M_`; bổ sung ma trận từng AC/GWT để dễ review, không tự khẳng định chuẩn FSS bắt buộc hay chứng nhận tuân thủ. | PAY-001–PAY-035; chú ý PAY-013/PAY-019 |
| 9 Blocker priority | Thiếu chi tiết nhẹ: bổ sung primaryReason/action matrix, eligibility vẫn xét toàn bộ blockers. | PAY-004, PAY-023, PAY-034 |
| 10 JobType | Không có mâu thuẫn SHALL đặt tên job: 12.7 không đặt tên, tên ở design đã ghi dự kiến. Liệt kê enum đích để rõ và vẫn ghi chưa migration/runtime. | PAY-035 |

## Exit criteria và evidence

- Mỗi AC 22.1–22.38 có ít nhất một case ở bảng và trace lại đúng số; 9.5/9.10/12.7/21.3 được dẫn chéo. Câu 1–2/verification/source isolation ở PAY-036; câu 3/lịch UTC/gộp theo UID ở PAY-037; câu 5/approve chờ lịch ở PAY-038; câu 6/bỏ lỡ đợt ở PAY-039; câu 7/gộp tổng và duyệt lại ở PAY-040; câu 8/cutoff ở PAY-041; câu 9/deferred retry ở PAY-042; câu 10/tự trả lần đầu ở PAY-043; câu 11/operator fees ở PAY-044; câu 12/fixed 1:1 ở PAY-045; câu 13/auto-only ở PAY-046; câu 14/minimum ở PAY-047; câu 15/balance-only funding ở PAY-048; câu 16/skip insufficient ở PAY-049, chưa chạy.
- Các test chỉ là planned cho tới khi implementation có và được chạy; mỗi case cần expected/actual, commit/migration và log đã loại secret, có assertion DB về unique/ledger/allocations cho case tiền.
- Chạy test concurrency/cutover/fault-injection bằng barriers có kiểm soát, không dùng sleep làm bằng chứng thứ tự; kiểm cả hai thứ tự race. Chứng minh sum allocations/counters/Wallet/source coverage và không có effect ngoại hệ thống trùng.
- Không mở sender nếu còn prerequisite quyền kênh/provider limits hoặc quote ở nhánh cần market valuation hoặc UNKNOWN/cutover coverage chưa giải quyết. Test pass trên mocks không chứng minh quyền API thật hoặc phê duyệt production.

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại (added/updated/removed) |
|---|---|---|---|---|
| 2026-10-30 | payables-rtm.md | PAY-013/PAY-046 bỏ phụ thuộc xác thực khách và truy cập riêng tư; giữ admin queue legacy/payables, redirect và retired POST | Quyết định người dùng 30/10/2026; cần kiểm chứng Task 44 | updated |
