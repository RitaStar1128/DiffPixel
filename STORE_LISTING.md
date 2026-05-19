# Chrome Web Store Listing Draft

## Short Description

Compare a web page with a reference image using an in-page overlay, grid, and simple floating controls.

## Detailed Description

DiffPixel helps you check whether a web page matches a design or screenshot.

Click the extension icon, upload a reference image, and compare it directly on the page. You can adjust opacity, position, scale, blend mode, and grid size from a floating panel while the page stays visible.

Images and settings stay on your device. DiffPixel does not send your uploaded images to a server.

## Item Introduction and Installation Benefits

DiffPixel is a simple visual comparison tool for web pages.

It is made for the moments when a page looks almost right, but you still want to check spacing, alignment, size, or layout against a design reference. Instead of switching between tabs or image tools, you can place the reference image over the live page and compare them in the browser.

After installation, open a page, click the DiffPixel icon, and upload a local PNG or JPG. A floating panel appears on the page, so you can keep the page visible while adjusting the overlay.

DiffPixel can help you:

- Compare a live page and a reference image in one place.
- Spot small visual differences with Difference blend mode.
- Adjust position, opacity, and scale with fine control.
- Use multiple layers for variants, responsive states, or component checks.
- Turn on a grid when you want to inspect spacing and alignment.
- Save overlay settings per site, locally in Chrome.
- Keep uploaded images private on your own device.

DiffPixel does not try to replace design tools or full QA platforms. It focuses on one job: making visual checks easier inside the browser.

Highlights:

- Floating in-page panel instead of a small browser popup.
- Multiple overlay layers with visibility, lock, invert, and delete controls.
- Blend modes including Difference, Multiply, Screen, Overlay, Hard Light, and Exclusion.
- Fine scale control with decimal input and keyboard arrow adjustment.
- Toggleable pixel grid with adjustable size.
- Local-only operation. Images and settings stay on the user's device.

## Category

Developer Tools

## Single Purpose

DiffPixel overlays local reference images on the active web page so users can visually compare design and implementation.

## Permission Justification

- `activeTab`: runs on the current page only after the user clicks the extension icon.
- `scripting`: injects the floating overlay panel and page styles.
- `storage`: saves per-site overlay layer settings locally.
- `unlimitedStorage`: stores local reference images and layer state without hitting the default quota during visual QA.

## Privacy Answers

DiffPixel does not collect user data. It stores uploaded images and settings locally in Chrome storage. It does not send data to servers, use analytics, show ads, or load remote code.

## Suggested Screenshots

- Floating panel opened on a web page with one reference layer.
- Difference blend mode comparing a reference to an implementation.
- Grid enabled with a small grid size.
- Multiple layers with one locked and one hidden.

## Suggested Test Instructions

1. Install the extension.
2. Open any normal HTTPS web page.
3. Click the DiffPixel icon to open the floating panel.
4. Upload a PNG or JPG reference image.
5. Toggle Grid, adjust scale and opacity, and verify the overlay updates on the page.

---

# Chrome Web Store Listing Draft - Japanese

## Short Description

Webページと参考画像を、ページ上のオーバーレイ・グリッド・フローティング操作でかんたんに比較できます。

## Detailed Description

DiffPixelは、Webページがデザインやスクリーンショットと合っているかを確認するための拡張機能です。

拡張機能アイコンをクリックして参考画像をアップロードすると、ページ上に画像を重ねて比較できます。ページを見たまま、透明度、位置、スケール、ブレンドモード、グリッドサイズをフローティングパネルから調整できます。

画像と設定は端末内に保存されます。アップロードした画像がサーバーへ送信されることはありません。

## Item Introduction and Installation Benefits

DiffPixelは、Webページの見た目を確認するためのシンプルな比較ツールです。

「ほぼ合っているけれど、余白や位置、サイズが本当に合っているか確認したい」場面で使えます。タブや画像編集ツールを行き来せず、参考画像を実際のページに重ねて、ブラウザ内でそのまま比較できます。

インストール後は、ページを開いてDiffPixelのアイコンをクリックし、PNGまたはJPG画像をアップロードするだけです。操作パネルはページ内に表示されるため、ページを見失わずに調整できます。

DiffPixelでできること:

- 実装中のページと参考画像を同じ画面で比較できます。
- Differenceなどのブレンドモードで、小さな見た目の差に気づきやすくなります。
- 位置、透明度、スケールを細かく調整できます。
- 複数レイヤーで、状態違いやレスポンシブ表示も確認できます。
- グリッドを表示して、余白や整列を確認できます。
- サイトごとの設定をChrome内にローカル保存できます。
- アップロード画像は端末内に残り、外部サーバーには送信されません。

DiffPixelは、デザインツールや本格的なQAサービスを置き換えるものではありません。ブラウザ上での見た目確認を、もっと手早く、わかりやすくすることに集中したツールです。

## Category

Developer Tools

## Single Purpose

DiffPixelは、ローカルの参考画像を現在のWebページに重ね、デザインと実装の見た目を比較できるようにします。

## Permission Justification

- `activeTab`: ユーザーが拡張機能アイコンをクリックした現在のタブでのみ動作するために使用します。
- `scripting`: ページ内にフローティングパネルとオーバーレイを表示するために使用します。
- `storage`: サイトごとのレイヤー設定をローカルに保存するために使用します。
- `unlimitedStorage`: 参考画像とレイヤー状態を、通常の保存容量制限に妨げられずローカル保存するために使用します。

## Privacy Answers

DiffPixelはユーザーデータを収集しません。アップロード画像と設定はChromeのローカルストレージに保存されます。サーバー送信、アクセス解析、広告、リモートコードの読み込みは行いません。

## Suggested Screenshots

- Webページ上でフローティングパネルを開き、参考画像を重ねた画面。
- Differenceブレンドモードで、参考画像と実装の差を確認している画面。
- 小さめのグリッドを表示している画面。
- 複数レイヤーを使い、片方をロックまたは非表示にしている画面。

## Suggested Test Instructions

1. 拡張機能をインストールします。
2. 通常のHTTPSページを開きます。
3. DiffPixelアイコンをクリックして、フローティングパネルを開きます。
4. PNGまたはJPGの参考画像をアップロードします。
5. グリッド、スケール、透明度を調整し、オーバーレイがページ上で更新されることを確認します。
