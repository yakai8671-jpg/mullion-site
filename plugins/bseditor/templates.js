/* The cell templates of BsEditor (TEMPLATE_CATALOG), as they were. */

export const TEMPLATE_CATALOG = [
  {
    id: 'tag-div',
    category: 'tag',
    title: '範囲ブロック (div)',
    description: 'コンテンツやセルをネストするための汎用的なブロック (div)',
    html: `<div><span data-edit="text">テキストコンテンツです。右サイドバーで子セルコンテナにも変更できます。</span></div>`,
    allowToggleMode: true,
    commonClasses: ['d-flex', 'd-block', 'd-none', 'text-center', 'p-3', 'bg-light', 'border', 'rounded', 'shadow-sm']
  },
  {
    id: 'tag-h1',
    category: 'tag',
    title: '見出し1 (h1)',
    description: '最重要のタイトル (h1)',
    html: `<h1 data-edit="text">大見出しの見出しテキスト</h1>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted', 'display-4']
  },
  {
    id: 'tag-h2',
    category: 'tag',
    title: '見出し2 (h2)',
    description: '主要セクション見出し (h2)',
    html: `<h2 data-edit="text">中見出しテキスト</h2>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted']
  },
  {
    id: 'tag-h3',
    category: 'tag',
    title: '見出し3 (h3)',
    description: '小セクション見出し (h3)',
    html: `<h3 data-edit="text">小見出しテキスト</h3>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted']
  },
  {
    id: 'tag-h4',
    category: 'tag',
    title: '見出し4 (h4)',
    description: '細かい見出しブロック (h4)',
    html: `<h4 data-edit="text">見出し4テキスト</h4>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted']
  },
  {
    id: 'tag-h5',
    category: 'tag',
    title: '見出し5 (h5)',
    description: '見出し5のブロック (h5)',
    html: `<h5 data-edit="text">見出し5テキスト</h5>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted']
  },
  {
    id: 'tag-h6',
    category: 'tag',
    title: '見出し6 (h6)',
    description: '最小サイズの見出しブロック (h6)',
    html: `<h6 data-edit="text">見出し6テキスト</h6>`,
    commonClasses: ['text-center', 'fw-bold', 'text-primary', 'text-muted']
  },
  {
    id: 'tag-p',
    category: 'tag',
    title: '段落 (p)',
    description: '標準的なテキスト段落 (p)',
    html: `<p data-edit="text">ここにテキスト段落の内容を入力します。右側の属性設定からスタイルを適用できます。</p>`,
    commonClasses: ['text-muted', 'text-center', 'fw-bold', 'lead', 'small']
  },
  {
    id: 'tag-img',
    category: 'tag',
    title: '画像 (img)',
    description: '画像表示要素 (img)。URLと代替テキストを属性設定から変更可能です。',
    html: `<img src="https://picsum.photos/600/400" alt="画像" class="img-fluid" data-edit-attr="src,alt">`,
    commonClasses: ['img-fluid', 'img-thumbnail', 'rounded', 'rounded-circle', 'shadow-sm', 'w-100', 'w-50', 'mx-auto']
  },
  {
    id: 'tag-table',
    category: 'tag',
    title: 'テーブル (table)',
    description: '標準的なプレーン表組み (table)',
    html: `<table data-edit-attr="class">
  <thead>
<tr>
  <th data-edit="text">#</th>
  <th data-edit="text">見出し</th>
  <th data-edit="text">見出し2</th>
</tr>
  </thead>
  <tbody>
<tr>
  <td data-edit="text">1</td>
  <td data-edit="text">データ1</td>
  <td data-edit="text">データ2</td>
</tr>
  </tbody>
</table>`,
    commonCategories: ['Components (Tables)']
  },
  {
    id: 'tag-ul',
    category: 'tag',
    title: 'リストコンテナ (ul)',
    description: '子要素をネストできる箇条書きリスト。',
    html: `<ul><div class="cell-container"></div></ul>`,
    fixedMode: 'container'
  },
  {
    id: 'tag-li',
    category: 'tag',
    title: 'リスト項目 (li)',
    description: 'リスト(ul/ol)の中に配置する項目。入れ子切替可能（見出しテキスト＋子リスト等を内包できます）。',
    html: `<li data-edit="text">リスト項目テキスト</li>`,
    allowToggleMode: true
  },
  {
    id: 'tag-ol',
    category: 'tag',
    title: '番号付きリスト (ol)',
    description: '子要素をネストできる自動番号付きリスト。',
    html: `<ol><div class="cell-container"></div></ol>`,
    fixedMode: 'container'
  },
  {
    id: 'tag-dl',
    category: 'tag',
    title: '説明リスト (dl)',
    description: '用語と定義用のコンテナ要素 (dl)',
    html: `<dl><div class="cell-container"></div></dl>`,
    fixedMode: 'container'
  },
  {
    id: 'tag-dt',
    category: 'tag',
    title: '説明用語 (dt)',
    description: '説明リスト(dl)で定義する用語の見出し。',
    html: `<dt data-edit="text">定義する用語</dt>`
  },
  {
    id: 'tag-dd',
    category: 'tag',
    title: '説明詳細 (dd)',
    description: '用語(dt)に対する説明文。',
    html: `<dd data-edit="text">用語に対する詳細説明テキスト</dd>`
  },
  {
    id: 'tag-blockquote',
    category: 'tag',
    title: '引用ブロック (blockquote)',
    description: '引用ブロック。入れ子切替可能。',
    html: `<blockquote><span data-edit="text">「ここに引用文が入ります」</span></blockquote>`,
    allowToggleMode: true,
    commonClasses: ['blockquote-footer', 'text-center', 'border-start', 'ps-3', 'fst-italic']
  },
  {
    id: 'tag-pre',
    category: 'tag',
    title: '整形済みテキスト (pre)',
    description: '改行やスペースがそのまま維持されるテキストブロック。',
    html: `<pre data-edit="text">プレフォーマットテキスト</pre>`,
    commonClasses: ['bg-light', 'p-2', 'rounded', 'text-danger']
  },
  {
    id: 'tag-code',
    category: 'tag',
    title: 'コード (code)',
    description: '等幅フォント要素。',
    html: `<code data-edit="text">const x = 42;</code>`,
    commonClasses: ['bg-light', 'p-2', 'rounded', 'text-danger']
  },
  {
    id: 'tag-kbd',
    category: 'tag',
    title: 'キーボード入力 (kbd)',
    description: 'キー操作を示すUI。',
    html: `<kbd data-edit="text">Ctrl + C</kbd>`,
    commonClasses: ['bg-light', 'p-2', 'rounded', 'text-danger']
  },
  {
    id: 'tag-samp',
    category: 'tag',
    title: '出力例 (samp)',
    description: 'システム出力例。',
    html: `<samp data-edit="text">Success</samp>`,
    commonClasses: ['bg-light', 'p-2', 'rounded', 'text-danger']
  },
  {
    id: 'tag-address',
    category: 'tag',
    title: '連絡先住所 (address)',
    description: '連絡先・住所ブロック。入れ子切替可能。',
    html: `<address><span data-edit="text">住所情報など</span></address>`,
    allowToggleMode: true,
    commonClasses: ['fst-italic', 'text-muted', 'small']
  },
  {
    id: 'tag-details',
    category: 'tag',
    title: '折りたたみ (details)',
    description: 'アコーディオン要素。open属性制御可能。入れ子切替可能。',
    html: `<details open>
  <summary data-edit="text">折りたたみタイトル</summary>
  <span data-edit="text">折りたたまれる詳細コンテンツです。右サイドバーで子セルコンテナにも変更できます。</span>
</details>`,
    allowToggleMode: true,
    commonCategories: ['Components (Accordion)']
  },
  {
    id: 'tag-hr',
    category: 'tag',
    title: '水平線 (hr)',
    description: 'プレーンな区切り線。',
    html: `<hr>`,
    commonClasses: ['border-top', 'border-2', 'opacity-25', 'my-4']
  },
  {
    id: 'tag-a',
    category: 'tag',
    title: 'リンク / アンカー (a)',
    description: '他のページや同一ページ内へのリンク (a)。HTML属性管理から href や name を設定できます。',
    html: `<a href="#" data-edit="text">リンクテキスト</a>`,
    commonClasses: ['link-primary', 'link-offset-2', 'text-decoration-none', 'fw-bold', 'btn', 'btn-primary']
  },
  {
    id: 'tag-icon',
    category: 'tag',
    title: 'アイコン (Bootstrap Icons)',
    description: 'Bootstrap Iconsのアイコン要素。右サイドバーでアイコン名を指定できます。',
    html: `<i class="bi bi-star-fill"></i>`,
    commonClasses: ['fs-1', 'fs-2', 'fs-3', 'text-primary', 'text-danger', 'text-success', 'me-2']
  },

  {
    id: 'bs-alert',
    category: 'bs',
    title: '情報アラート (Alert)',
    description: '中に他の要素をネストできる情報枠コンテナ (枠線編集対応)。',
    html: `<div class="alert alert-info" role="alert">
  <div class="cell-container"></div>
</div>`,
    fixedMode: 'container',
    commonCategories: ['Components (Alerts)']
  },
  {
    id: 'bs-card',
    category: 'bs',
    title: '標準カード (Card)',
    description: '独自のセルをドラッグ＆ドロップしてデザインできる標準カード。',
    html: `<div class="card shadow-sm mx-auto" style="max-width: 350px;">
  <div class="cell-container"></div>
</div>`,
    fixedMode: 'container',
    commonCategories: ['Components (Cards)']
  },
  {
    id: 'bs-hero',
    category: 'bs',
    title: 'ヒーローセクション (Hero)',
    description: 'アピールエリアコンテナ。中に見出しや段落を自由に配置可能。',
    html: `<div class="p-5 mb-4 bg-light rounded-3 border">
  <div class="container-fluid py-3">
<div class="cell-container"></div>
  </div>
</div>`,
    fixedMode: 'container',
    commonClasses: ['bg-light', 'bg-primary', 'text-white', 'text-center', 'p-5', 'rounded-3']
  },
  {
    id: 'bs-grid2',
    category: 'bs',
    title: '2カラムグリッド (Grid 2)',
    description: 'レスポンシブな2分割の横並びコンテナ (コンテナ固定・プレーン仕様)。',
    html: `<div class="row">
  <div class="col-md-6 mb-3">
<div class="cell-container"></div>
  </div>
  <div class="col-md-6 mb-3">
<div class="cell-container"></div>
  </div>
</div>`,
    fixedMode: 'container',
    commonClasses: ['g-3', 'g-0', 'align-items-center', 'justify-content-center', 'text-center']
  },
  {
    id: 'bs-grid3',
    category: 'bs',
    title: '3カラムグリッド (Grid 3)',
    description: 'レスポンシブな3分割の横並びコンテナ (コンテナ固定・プレーン仕様)。',
    html: `<div class="row">
  <div class="col-lg-4 col-md-6 mb-3">
<div class="cell-container"></div>
  </div>
  <div class="col-lg-4 col-md-6 mb-3">
<div class="cell-container"></div>
  </div>
  <div class="col-lg-4 col-md-12 mb-3">
<div class="cell-container"></div>
  </div>
</div>`,
    fixedMode: 'container',
    commonClasses: ['g-3', 'g-0', 'align-items-center', 'justify-content-center', 'text-center']
  },
  {
    id: 'bs-jumbo-media',
    category: 'bs',
    title: 'メディアオブジェクト (Media)',
    description: '左側の画像枠（slot 0）と、右側のテキスト枠（slot 1）が並ぶレイアウト。',
    html: `<div class="d-flex align-items-center p-3 border rounded bg-white">
  <div class="flex-shrink-0" style="min-width: 80px;">
<div class="cell-container"></div>
  </div>
  <div class="flex-grow-1 ms-3">
<div class="cell-container"></div>
  </div>
</div>`,
    fixedMode: 'container',
    commonClasses: ['align-items-start', 'align-items-center', 'gap-3', 'p-4', 'bg-light', 'rounded']
  }
];
