import { useNavigate } from 'react-router-dom';
import { Icons } from '../lib/icons';
import guideMd from '../../docs/USER_GUIDE.md?raw';

/* 行内 **加粗** */
function inline(text) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/* 极简 Markdown 渲染:只支持指南中使用的语法(#/##/###、>、-、1.、表格、**加粗**),
   单一事实来源是 docs/USER_GUIDE.md(通过 ?raw 导入,构建期打包)。 */
function renderGuide(md) {
  const blocks = [];
  let list = null;
  let table = null;
  const flush = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
    if (table) {
      blocks.push(table);
      table = null;
    }
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() });
      continue;
    }
    if (/^\s*$/.test(line)) {
      flush();
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      blocks.push({ t: 'q', text: line.slice(2) });
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (!list || list.ordered) {
        flush();
        list = { t: 'list', ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (!list || !list.ordered) {
        flush();
        list = { t: 'list', ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // 表格分隔行
      if (!table) {
        flush();
        table = { t: 'table', rows: [] };
      }
      table.rows.push(line.slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    flush();
    blocks.push({ t: 'p', text: line });
  }
  flush();

  return blocks.map((b, i) => {
    switch (b.t) {
      case 'h':
        if (b.level === 1) return <h1 key={i} className="guide-title">{inline(b.text)}</h1>;
        if (b.level === 2) return <h2 key={i} className="guide-h2">{inline(b.text)}</h2>;
        return <h3 key={i} className="guide-h3">{inline(b.text)}</h3>;
      case 'q':
        return <p key={i} className="guide-quote">{inline(b.text)}</p>;
      case 'list':
        return b.ordered ? (
          <ol key={i} className="guide-ol">
            {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </ol>
        ) : (
          <ul key={i} className="guide-ul">
            {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </ul>
        );
      case 'table': {
        const [head, ...rows] = b.rows;
        return (
          <div key={i} className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, j) => (
                  <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return <p key={i}>{inline(b.text)}</p>;
    }
  });
}

/* 使用指南独立页:/guide。不依赖登录态,访客可直接阅读;无 Shell 顶栏,自带返回入口。 */
export function GuidePage() {
  const navigate = useNavigate();
  return (
    <div className="guide-page">
      <header className="guide-topbar">
        <button type="button" className="nav-logo" onClick={() => navigate('/')} aria-label="返回上传首页">
          <span className="logo-mark" aria-hidden="true">
            <Icons.logo size={18} />
          </span>
          <span className="logo-name">SnapTask</span>
        </button>
        <span className="xsmall muted">使用指南</span>
        <button type="button" className="btn btn-secondary btn-sm guide-back" onClick={() => navigate('/')}>
          <Icons.arrowLeft size={14} />
          返回首页
        </button>
      </header>
      <main className="guide-content">{renderGuide(guideMd)}</main>
    </div>
  );
}
