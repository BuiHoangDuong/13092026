# Kế hoạch chỉnh sửa giao diện — Dark Aurora

Ngày lập: 2026-10-13. Cập nhật 2026-10-14: đã triển khai Dark Aurora vào Next.js và build/test Docker local; đang giữ http://localhost:3000 để người dùng kiểm tra. Visual QA trên browser còn mở.

Đồng bộ spec ngày 2026-10-14: `requirements.md` ghi nhận Dark Aurora và mô hình calculator theo plan (#23–25, Req 19.8/20.7); `design.md` đã sửa styling/bố cục; `tasks.md` có Task 40. Spec là nguồn sự thật; tài liệu này bổ sung chi tiết triển khai. Đổi tên #22 vẫn mở, giữ Cashback Hub hiện tại.

## 1. Thiết kế đã chốt

Tham chiếu: [dark-aurora.html](../mockups/dark-aurora.html). Toàn bộ nội dung giao diện bằng tiếng Anh. Giữ tên hiện tại **Cashback Hub**; không tự đổi sang tên `RebateFlow` đang được đề xuất trong spec.

- Nền tối xanh đen, ánh sáng aurora nhẹ, điểm nhấn cam ấm, typography và khoảng trống theo mockup.
- Giữ hero `Same trades. More coming back.` và hình ví cũ: 248.50 USDT available, 42.80 USDT pending, 1,206.00 USDT paid out cùng hai thẻ nổi. Đây là hình minh họa, luôn có nhãn `Illustrative wallet`; không gắn với tài khoản khách.
- Đặt **THE CASHBACK OPPORTUNITY CHECK** ngay bên dưới toàn bộ hero/hình ví. Viền sáng, kết quả tiền lớn và tổng 12 tháng giúp khách thấy giá trị có thể bỏ lỡ.
- Chỉ có **Bybit, Binance, MEXC** trong bản mockup: dải logo, thẻ ưu đãi và cả hai dropdown.
- Dùng logo ảnh cục bộ, giữ tỷ lệ và khoảng trống quanh logo; không thay tên sàn bằng icon tự chế.
- Thẻ ưu đãi rộng, dễ đọc, ba cột trên desktop và một cột trên mobile; bỏ kiểu ô vuông marketplace của homepage hiện tại.

## 2. Kết quả đọc dự án

### Các sàn và dữ liệu mẫu

`packages/db/prisma/seed.ts` khai báo đúng ba sàn sau. Chưa truy vấn database đang chạy; seed không chứng minh số lượng bản ghi hoặc tỷ lệ hiện tại trên production.

| Sàn | Slug | Tỷ lệ mẫu trên hoa hồng affiliate đủ điều kiện | Logo ứng dụng hiện có | Logo mockup |
| --- | --- | --- | --- | --- |
| Bybit | `bybit` | 30% | `/exchange-logos/bybit.png` | `assets/exchange-logos/bybit.png` |
| Binance | `binance` | 40% | `/exchange-logos/binance.png` | `assets/exchange-logos/binance.png` |
| MEXC | `mexc` | 35% | `/exchange-logos/mexc.png` | `assets/exchange-logos/mexc.webp` |

Các tỷ lệ này đã được đồng bộ vào card, popup và calculator mockup. Ví dụ phí 500 USDT/tháng, giả định affiliate commission 50%: Bybit 75 USDT/tháng, Binance 100 USDT/tháng, MEXC 87.50 USDT/tháng. Đây không phải tỷ lệ hoàn trực tiếp trên tổng phí giao dịch.

Ứng dụng thật dùng `listPublishedExchanges()` và `listPublishedOfferCards()` trong `packages/core/src/services/content.ts`. Mỗi offer đã công bố có một card; một sàn có thể có nhiều offer. Không hard-code tỷ lệ seed hoặc ép dữ liệu thành đúng ba card nếu sau này admin công bố thêm offer. Với bộ dữ liệu hiện tại, giao diện chỉ hiển thị ba sàn người dùng đang sử dụng.

### Giao diện và luồng trước khi chỉnh sửa (đối chiếu 2026-10-13)

- `HomeContent` trong `apps/web/src/components/public-pages.tsx` render server-side; lookup đang ở trước hero, card dạng ô vuông, có số marketing mẫu và `RebateLedgerDemo`.
- `OfferCard`/`OfferDetailCard` đã có `logoUrl`, điều kiện, tỷ lệ và liên kết referral qua `/go/{linkId}`. Giữ cách ghép offer với link trong core.
- `CashbackLookup` gọi `POST /api/lookup`, validate `lookupResponseSchema`, hiển thị pending/available theo từng tài sản, giao dịch đã attribution và thời điểm dữ liệu. Có xử lý HTTP 429 bằng `Retry-After`.
- Lookup dẫn tới `/withdraw?exchangeId=...&uid=...`; `/withdraw` đã có UID session và xác minh email. Header hiện trỏ Wallet tới `/me/wallet`, trong khi không có route này trong cây `app`; cần sửa sang `/withdraw` theo Req 20.4.
- Root layout và CSS dùng chung với admin. Phải giới hạn theme Aurora vào public shell để không làm lệch màn admin.
- `getPublicStats()` chỉ cung cấp số sàn đã công bố, không cung cấp số người dùng hay số quốc gia. Không đưa các con số marketing chưa có nguồn vào thiết kế mới.
- Worker có kiểm tra readiness cho Bybit, MEXC, Binance. Riêng Binance hiện là GET-only raw intake theo design: không tự ghi UID metrics, CommissionRecord hoặc ví. Việc có card Binance không đồng nghĩa ví của khách đã có cashback đồng bộ tự động.

## 3. Bố cục đích

1. **Header:** logo Cashback Hub; `Opportunity check`, `Exchange offers`, `How it works`; CTA `Check cashback`; thêm lối vào `Wallet` trỏ `/withdraw`. Mobile dùng menu có nút mở/đóng, hỗ trợ bàn phím.
2. **Hero:** headline, lời giới thiệu, `Find your exchange`, `Check my cashback`, ba lợi ích ngắn; giữ hình ví và hai thẻ nổi của mockup.
3. **Opportunity Check:** chọn sàn/offer, phí hàng tháng, preset, giả định affiliate commission, kết quả theo tháng và 12 tháng. Kết quả là điểm nhấn mạnh nhất sau hero.
4. **Exchange strip:** logo Bybit, Binance, MEXC từ các sàn đã công bố; deduplicate theo exchange ID.
5. **UID lookup:** `Your cashback, one lookup away.`; form sàn + UID, kết quả thật và CTA rút tiền hiện có.
6. **Published offers:** card ba cột, logo, tỷ lệ `share of eligible affiliate commission`, ví dụ trên 100 đơn vị commission, điều kiện và CTA vào trang chi tiết hiện có.
7. **How it works:** Explore → Join → Track, nội dung tương ứng mockup.
8. **Rebate ledger:** giữ chức năng Req 17 trong giai đoạn chuyển giao, đặt sau How it works; áp dụng theme Aurora và giữ badge `illustrative example — not live data`. Mockup hiện không có block này; không tự xóa chức năng đã yêu cầu chỉ để khớp hình.
9. **FAQ và footer:** giải thích cách tính, điều kiện tài khoản, UID, rút tiền; liên kết đến route hoặc section tồn tại.

Header sticky không che tiêu đề khi nhảy anchor; thêm `scroll-margin-top`. Ở màn hẹp, thẻ ví và thẻ nổi phải thu gọn trong khung; không tạo cuộn ngang. Logo strip giữ ba cột đủ khoảng trống, card offer chuyển một cột.

## 4. Calculator: thu hút nhưng rõ cách tính

### Mô hình tham chiếu

```text
Eligible affiliate commission = Monthly trading fees × Commission assumption / 100
Potential monthly cashback   = Eligible affiliate commission × Cashback share / 100
Potential annual cashback    = Potential monthly cashback × 12
```

- Giữ nhãn `Illustrative estimate`, đầu vào, công thức và ghi chú điều kiện ngay cạnh kết quả. Ví dụ 50% affiliate commission là giả định có thể chỉnh, không phải tỷ lệ sàn đã xác minh.
- Tỷ lệ cashback đọc từ offer đã công bố; đổi sàn/offer thì đổi tỷ lệ và điều kiện tương ứng. Dùng tỷ lệ mặc định của exchange chỉ khi phù hợp quy tắc Req 7.3 và có nhãn rõ nguồn; không giả lập một offer chưa được công bố.
- Khi một sàn có nhiều offer, phải chọn một offer cụ thể để tính và dẫn đúng CTA; không âm thầm lấy tỷ lệ cao nhất rồi dẫn sang offer khác.
- Đơn vị tiền phải nhất quán trong đầu vào/kết quả. Mockup dùng USDT; không coi USD và USDT là một phép chuyển đổi tỷ giá tự động.
- Rỗng, âm, không hữu hạn hoặc tỷ lệ ngoài 0–100%: hiện lỗi, xóa kết quả hợp lệ cũ. Phí 0 hoặc tỷ lệ 0 cho kết quả 0 hợp lệ. Giới hạn 1,000,000 USDT trong mockup là giới hạn demo, cần ghi vào spec nếu giữ cho ứng dụng thật.
- Tách hàm tính/validation khỏi component; dùng phép tính thập phân và chỉ làm tròn khi hiển thị. Không dùng rounding giao diện để thay đổi dữ liệu ví.
- Tính trong trình duyệt, không gửi/lưu đầu vào lên server; không tạo API mới hoặc ghi `WalletEntry`. Offer vẫn render server-side, calculator là client island nhận props đã chuẩn hóa.
- Copy gợi tiếc nuối dựa trên giả định: `See what you could be missing.` và `Another month ... under these assumptions.` Không khẳng định khách đã mất tiền thật, không tạo countdown hoặc số người tham gia giả.
- Giữ ghi chú `Past fees cannot be claimed retroactively.` CTA dẫn lookup hoặc đúng offer; ước tính không trở thành số dư available.

### Điểm cần đồng bộ với spec

Req 19–20 / #23–25 đã chốt theo yêu cầu triển khai plan: phí/tháng USDT, affiliate commission assumption mặc định minh họa 50%, share từ published offer cụ thể, kết quả tháng/12 tháng. Phí tối đa 1,000,000 và input tối đa 8 chữ số thập phân; fixed-point BigInt, round half-up đến 2 chữ số khi hiển thị (Req 19.8). Không triển khai chế độ phí/ngày hoặc volume trong đợt này.

Đã triển khai bám mockup: giữ đầu vào hàng tháng, trả kết quả tháng và 12 tháng; commission là giả định có nhãn rõ, share lấy từ published offer. Nếu muốn công khai tỷ lệ affiliate đã xác minh thay cho giả định, phải bổ sung nguồn dữ liệu đó trước; source hiện đọc được không đủ để suy ra tỷ lệ này từ cashback share.

## 5. Ghép vào code hiện tại

Các component/helper dưới đây đã được tạo. Public shell dùng usePathname để phân biệt admin và nhận server-rendered children/legacy chrome từ RootLayout, không cần di chuyển route. Bảng ghi phạm vi công việc; trạng thái thực hiện ở Task 40 và checklist bên dưới.

| File/khu vực | Công việc |
| --- | --- |
| `.kiro/specs/cashback-platform/requirements.md` | Ghi nhận hướng Aurora đã chốt ở Open decision #25; làm rõ đầu vào/kỳ theo #23–24 khi triển khai, giữ Req 4/7/14/15/17. Không gộp các quyết định payout Req 21 vào đổi UI. |
| `.kiro/specs/cashback-platform/design.md` | Sửa dòng Styling còn ghi light blue/teal; đổi thứ tự đề xuất lookup-before-calculator thành hero → calculator → logos → lookup → offers; mô tả public shell và client island. Ghi changelog. |
| `.kiro/specs/cashback-platform/tasks.md` | Thêm các task UI có liên kết Req 19/20 và tiêu chí kiểm tra; không đánh dấu hoàn thành trước khi code/QA đạt. |
| `apps/web/src/components/public-pages.tsx` | Giữ SSR và các export trang hiện có; thay nội dung/bố cục `HomeContent`, refactor card mới dùng dữ liệu published; xử lý trạng thái chưa có offer và lỗi tải riêng biệt. |
| `apps/web/src/components/public/aurora-hero.tsx` | Tái tạo hero/hình ví bằng HTML/CSS có nhãn minh họa; không gọi API ví và không cần biến cả homepage thành client component. |
| `apps/web/src/components/public/opportunity-check.tsx` | Client component cho form, preset, assumptions, validation, kết quả và CTA. |
| `apps/web/src/lib/opportunity.ts` | Hàm tính thập phân, validation và formatting/đơn vị, có test trường hợp có ý nghĩa. Không nhập service DB vào client bundle. |
| `apps/web/src/components/cashback-lookup.tsx` | Đổi presentation theo Aurora; giữ API/schema, số dư theo asset, transactions, freshness và URL rút tiền. Làm rõ empty/loading/error; giữ UID dạng chuỗi. |
| `apps/web/src/components/public/public-shell.tsx` | Header/footer public, menu mobile và brand; bố trí wrapper để theme không áp vào admin. |
| `apps/web/src/app/layout.tsx` và public route layouts | Tách vị trí shell/theme theo public routes, giữ LocaleProvider và admin auth/layout. Kiểm tra route tree trước khi chuyển route group; URL hiện tại phải giữ nguyên. |
| `apps/web/src/app/globals.css` và CSS public | Dùng Tailwind/component primitives hiện có; thêm tokens/styles scoped dưới public shell, giữ token admin. Tái tạo glow, wallet, calculator và logo sizing từ mockup. |
| `apps/web/src/i18n/messages/en.ts` | Thêm English copy cho hero/calculator/menu/FAQ, validation và empty states; tránh rải chuỗi trong component. |
| `apps/web/src/lib/site.ts` | Tập trung tên Cashback Hub đang dùng để header/footer/metadata nhất quán; không tự duyệt một tên thương hiệu mới. |
| `apps/web/public/exchange-logos/` | Dùng Bybit/Binance PNG hiện có. Nếu đưa MEXC lockup mới từ mockup vào ứng dụng, xuất PNG nền trong suốt vào đường dẫn `mexc.png` hiện có, giữ tỷ lệ/nguồn ở SOURCES; không cần thay schema hoặc seed. |

### Các chi tiết tích hợp cần giữ

- Danh sách sàn lookup lấy từ published exchanges; logo strip deduplicate, offer card giữ định danh `offerId`. Không dùng tên hiển thị làm khóa gọi API.
- Trạng thái chưa có dữ liệu lookup khác với số dư thật bằng 0. Loading/HTTP 429/lỗi mạng phải có thông báo tiếng Anh và không để kết quả lần trước hiển thị như kết quả mới.
- UID giữ số 0 đầu; không ép kiểu số. Kết quả phải gắn với lựa chọn đã submit; thay UID/sàn thì xóa kết quả cũ. Giữ `lastImportAt`/`sourceAsOf` và phân biệt commission với cashback.
- Wallet dẫn `/withdraw`; CTA từ lookup giữ exchange ID và UID trong query. Các kiểm soát OTP, UID session, holding period và xét duyệt rút tiền nằm ở luồng hiện có.
- Card link đến trang chi tiết `/exchanges/{slug}` hiện có; đăng ký từ offer dùng `/go/{linkId}`. Không sao chép modal demo thành logic referral mới.
- Khi mất kết nối dữ liệu, hiển thị unavailable; không thay bằng số dư demo hoặc tỷ lệ seed. Khi không có published offer, hiển thị empty state và vô hiệu hóa tính toán cần offer.
- Bỏ stats người dùng/quốc gia không có nguồn; nếu giữ số sàn thì đọc `getPublicStats()`. Không đưa badge `verified` vào card chỉ vì có logo.
- Dùng logo local qua Next Image với kích thước cố định, `object-contain`, alt là tên sàn; có fallback khi thiếu/lỗi logo. Font có fallback và tránh tải trực tiếp Google Fonts bằng CSS `@import` như bản mockup.
- Ledger demo vẫn giữ generator và badge theo Req 17; không đọc ví thật để làm ticker trong đợt đổi UI.

## 6. Các bước triển khai

### Bước 1 — Đồng bộ spec với thiết kế đã chọn

- [x] Cập nhật mô tả styling, bố cục và Open decision #25 sang Dark Aurora; ghi changelog (2026-10-14, Task 40.0).
- [x] Chốt calculator/tháng, USDT, 12 tháng, commission assumption, giới hạn và rounding ở #23–24 / Req 19.8 trước implement.
- [x] Ghi rõ giữ Cashback Hub hiện tại; #22 chỉ liên quan yêu cầu đổi tên sau này.
- [x] Ghi vị trí ledger vào design để giữ Req 17; thêm Task 40.2 để triển khai.

### Bước 2 — Shell và hero

- [x] Tách public shell; thêm navigation mobile, sửa đường dẫn Wallet.
- [x] Áp tokens, typography và khoảng cách Aurora; hoàn thiện hero/hình ví.
- [x] Kiểm tra admin login/shell vẫn dùng giao diện hiện có.

### Bước 3 — Offers và các section tĩnh

- [x] Đổi card offer, logo strip, How it works, FAQ và footer.
- [x] Lấy data từ service hiện có; giữ SSR, nhiều offer/sàn và mapping referral.
- [x] Đồng bộ trang exchanges/detail/guides với public shell và kiểu card; không chỉ sửa homepage rồi để trang chi tiết lệch theme.
- [x] Giữ ledger với nhãn minh họa; bỏ stats marketing chưa có dữ liệu.

### Bước 4 — Calculator và UID lookup

- [x] Implement hàm tính và client island, props từ published offer, validation và accessible outputs.
- [x] Restyle lookup và kiểm tra lại toàn bộ states; giữ endpoint và withdrawal flow.
- [x] Thay copy/amount demo của mockup bằng data thật ở đúng section. Hình ví hero tiếp tục là minh họa có nhãn.

### Bước 5 — Kiểm tra và bàn giao

- [x] Test calculator: ba tỷ lệ seed, số 0, số thập phân, input rỗng/âm/không hữu hạn, tỷ lệ 0/100/>100, đổi offer và xóa kết quả cũ khi lỗi.
- [x] HTTP lookup no-data/multi-asset/429/validation, UID số 0 đầu, prefill đúng trên /withdraw; DOM tests kiểm tra loading/network/JSON/schema error, 429, response cũ và unmount. Browser QA thực tế vẫn riêng.
- [x] HTTP kiểm tra published offer trong HTML server và referral URL đúng. Empty/unavailable đã tách trong code; chưa giả lập lỗi DB trên browser.
- [ ] Soát giao diện tại 360, 390, 768, 1024, 1440px; chụp ảnh để đối chiếu mockup. Không cuộn ngang, card không cắt logo/amount, hero không đè calculator.
- [x] DOM tests kiểm tra menu Escape/focus, labels/ID references và calculator/lookup state changes; mock Next navigation chỉ trong test.
- [ ] Kiểm tra Tab/Enter/Escape trên browser thật, menu mobile, tương phản WCAG 2.1 AA và `prefers-reduced-motion`; ledger dừng chuyển động theo spec.
- [x] Chạy `pnpm --filter @cashback/web typecheck`, `pnpm --filter @cashback/web lint` và web build theo workflow repo. Build có thể cần build các workspace dependency trước.
- [x] Mọi check có DB hoặc chạy web để test dùng stack Docker trong `infra/docker-compose.yml` theo steering; kiểm tra URL test trước, không dùng Railway để test/dev.
- [x] Bàn giao diff, URL local và kết quả checks; Task 40.1–40.4 đã hoàn thành. Ảnh desktop/mobile và browser QA thuộc Task 40.5 còn mở.

## 7. Tiêu chí hoàn thành

- Trang chủ giữ đúng hero/hình ví cũ, Opportunity Check ở bên dưới và là khối nổi bật tiếp theo.
- Với dữ liệu ba sàn hiện tại, chỉ Bybit/Binance/MEXC xuất hiện; logo rõ, tỷ lệ UI khớp published offer thay vì hard-code mockup.
- Tất cả UI/errors/metadata bằng tiếng Anh, tên Cashback Hub nhất quán.
- Khách thấy được khoản cashback tiềm năng, công thức và điều kiện; không nhầm với số dư thật hoặc tiền quá khứ có thể nhận lại.
- Lookup, referral và rút tiền hiện có hoạt động; dữ liệu theo asset và freshness còn đầy đủ. Admin không bị áp theme public.
- Mobile/keyboard/reduced motion và các checks ở bước 5 đạt. Khi chưa chụp/kiểm tra trên trình duyệt, không ghi visual QA đã đạt.

## 8. Bàn giao Docker local — 2026-10-14

- URL: **http://localhost:3000**. Web và Postgres đang chạy/healthy, giữ localhost đến khi người dùng yêu cầu tắt. Worker không cần khởi động để kiểm tra public UI.
- Build bằng Dockerfile và lệnh Railway của repo; web startup migrate Docker Postgres hiện có, không reset/seed lại dữ liệu. Không deploy Railway hoặc sửa logic payout.
- Rebuild Docker theo source mới; 26 web tests (gồm 11 DOM interaction tests) và 4 core lookup-version tests đạt. Synthetic UID/wallet/commission fixtures chỉ ở Docker và đã dọn.
- Tests DOM đã tìm và xác nhận sửa lỗi chọn offer stale/khôi phục khi props có data, output trỏ tới field không tồn tại, và lookup lộ lỗi transport/schema. Test HTTP rate-limit dùng IP documentation IPv6 riêng để tránh trùng budget giữa các run.
- CUA không có browser khả dụng và không mở được tab IAB. Chưa chụp ảnh hay kiểm chứng 360–1440px/keyboard/contrast bằng browser audit; Task 40.5 giữ mở cho visual QA/người dùng kiểm tra bản local.
- Context7: đối chiếu composition Server Component children qua client wrapper và usePathname bằng docs Next.js 15.1.11 (không có đúng patch 15.5.25); build/test dùng đúng Next.js 15.5.25 / React 19.1.1 của lockfile.
- Đợt DOM tests đối chiếu tài liệu chính thức React `act`/`createRoot`, jsdom `JSDOM`/giới hạn rendering, esbuild plugins/bundle API qua Context7. Catalog docs không có đúng mọi patch; packages test pin jsdom 26.1.0, esbuild 0.25.12 và chạy với React 19.1.1 thực của repo. Đây là tests DOM, không chụp ảnh hay kiểm chứng layout.

Lệnh lặp lại checks trong Docker đang chạy:

```powershell
docker compose -f infra/docker-compose.yml --profile app exec -T web pnpm --filter @cashback/web typecheck
docker compose -f infra/docker-compose.yml --profile app exec -T web pnpm --filter @cashback/web lint
docker compose -f infra/docker-compose.yml --profile app exec -T -e AURORA_SMOKE_URL=http://127.0.0.1:3000 web pnpm --filter @cashback/web test
docker compose -f infra/docker-compose.yml --profile app exec -T web pnpm --filter @cashback/core exec node --test test/lookup-version.test.mjs
```

Kiểm tra trực tiếp: giữ hình ví hero → calculator bên dưới; đổi Bybit/Binance/MEXC (500 fees, 50% assumption cho 75/100/87.50 USDT); thử input rỗng/âm; tra UID của bạn hoặc xem no-data; Wallet mở xác minh email; thu nhỏ màn hình và mở menu mobile. Không cần gửi OTP/rút tiền để đánh giá bố cục.

`mockups/` vẫn bị Git ignore; spec và code ứng dụng đã ghi lại thiết kế, không phụ thuộc mockup để chạy.

Phương án các nhóm nghiệp vụ/vận hành còn mở sau UI: [remaining-work-plan.md](remaining-work-plan.md). Ưu tiên đề xuất Task 18 kiểm chứng luồng import → attribution → ví/rút tiền bằng Docker fixtures; data gate của các sàn và auto payout có điều kiện riêng, chưa triển khai trong đợt này.
