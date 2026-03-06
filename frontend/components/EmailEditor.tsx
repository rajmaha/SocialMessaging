'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { useEffect, useRef, useState } from 'react'
import MediaLibraryModal from './MediaLibraryModal'
import { CustomTableCell, CustomTableHeader } from './tiptap-table-cells'

const MERGE_TAGS = [
  { label: 'First Name', tag: '{{first_name}}' },
  { label: 'Last Name', tag: '{{last_name}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Unsubscribe', tag: '{{unsubscribe_link}}' },
]

const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Trebuchet', value: 'Trebuchet MS, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier', value: 'Courier New, monospace' },
]

interface EmailEditorProps {
  content: string
  onChange: (html: string) => void
}

function Divider() {
  return <span className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0 self-center" />
}

function ToolBtn({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-1.5 py-1 rounded text-sm font-medium transition-colors flex-shrink-0 ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
      }`}>
      {children}
    </button>
  )
}

const CONDITION_TYPES = ['Tag', 'Status', 'Source'] as const

export default function EmailEditor({ content, onChange }: EmailEditorProps) {
  const [mediaOpen, setMediaOpen] = useState(false)
  const [dynOpen, setDynOpen] = useState(false)
  const [dynCondition, setDynCondition] = useState<string>('tag')
  const [dynValue, setDynValue] = useState('')
  const dynBtnRef = useRef<HTMLButtonElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyleKit,
      Image.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
      CustomTableCell,
      CustomTableHeader,
    ],
    content: content || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  useEffect(() => {
    if (!editor || !content) return
    if (editor.getHTML() === content) return
    editor.commands.setContent(content, { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  if (!editor) return null

  const inTable = editor.isActive('table')

  return (
    <>
      <MediaLibraryModal
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onSelect={url => editor.chain().focus().setImage({ src: url }).run()}
      />

      <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">

        {/* ── Merge tag bar ── */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-indigo-50 border-b border-indigo-100">
          <span className="text-xs font-semibold text-indigo-600 mr-1 flex-shrink-0">Insert:</span>
          {MERGE_TAGS.map(({ label, tag }) => (
            <button key={tag} type="button"
              onClick={() => editor.chain().focus().insertContent(tag).run()}
              title={label}
              className="px-2 py-0.5 bg-white border border-indigo-200 rounded text-xs text-indigo-700 hover:bg-indigo-100 font-mono transition-colors">
              {tag}
            </button>
          ))}

          <span className="w-px h-4 bg-indigo-200 mx-1 flex-shrink-0 self-center" />

          {/* Dynamic block inserter */}
          <div className="relative flex-shrink-0">
            <button ref={dynBtnRef} type="button"
              onClick={() => setDynOpen(o => !o)}
              className={`px-2 py-0.5 border rounded text-xs font-medium transition-colors ${
                dynOpen
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-100'
              }`}>
              ⚡ Dynamic
            </button>

            {dynOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-64"
                onClick={e => e.stopPropagation()}>
                <p className="text-xs font-semibold text-gray-700 mb-2">Insert Dynamic Block</p>

                <label className="block text-xs text-gray-600 mb-1">Condition type</label>
                <select
                  value={dynCondition}
                  onChange={e => setDynCondition(e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400">
                  {CONDITION_TYPES.map(t => (
                    <option key={t} value={t.toLowerCase()}>{t}</option>
                  ))}
                </select>

                <label className="block text-xs text-gray-600 mb-1">Value</label>
                <input
                  type="text"
                  value={dynValue}
                  onChange={e => setDynValue(e.target.value)}
                  placeholder='e.g. "vip", "active"'
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-3 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />

                <button type="button"
                  disabled={!dynValue.trim()}
                  onClick={() => {
                    const val = dynValue.trim()
                    if (!val) return
                    const block = `{{#if ${dynCondition}="${val}"}}\n<div>Content for matching leads</div>\n{{#else}}\n<div>Content for other leads</div>\n{{/if}}`
                    editor.chain().focus().insertContent(block).run()
                    setDynValue('')
                    setDynOpen(false)
                  }}
                  className="w-full text-xs font-medium bg-indigo-600 text-white rounded px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Insert Block
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Main toolbar ── */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
          <select title="Font Family"
            onChange={e => {
              const v = e.target.value
              if (v) editor.chain().focus().setFontFamily(v).run()
              else editor.chain().focus().unsetFontFamily().run()
            }}
            className="text-xs border border-gray-300 rounded px-1 py-0.5 mr-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400">
            {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          <Divider />

          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><strong>B</strong></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><em>I</em></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><s>S</s></ToolBtn>

          <Divider />

          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="H1">H1</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="H2">H2</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="H3">H3</ToolBtn>

          <Divider />

          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">⬅</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center">≡</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">➡</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">☰</ToolBtn>

          <Divider />

          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolBtn>

          <Divider />

          {/* Text color */}
          <label className="relative flex-shrink-0 flex flex-col items-center px-1.5 py-0.5 rounded hover:bg-gray-100 cursor-pointer" title="Text color">
            <span className="text-xs font-bold leading-tight" style={{ color: editor.getAttributes('textStyle').color || '#000' }}>A</span>
            <span className="w-4 h-1 rounded-sm mt-0.5" style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000' }} />
            <input type="color" defaultValue="#000000"
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              onChange={e => editor.chain().focus().setColor(e.target.value).run()} />
          </label>

          {/* Highlight color */}
          <label className="relative flex-shrink-0 flex flex-col items-center px-1.5 py-0.5 rounded hover:bg-gray-100 cursor-pointer" title="Highlight / background color">
            <span className="text-xs font-bold leading-tight text-gray-700">A̲</span>
            <span className="w-4 h-1 rounded-sm mt-0.5 border border-gray-300" style={{ backgroundColor: '#FBBF24' }} />
            <input type="color" defaultValue="#FBBF24"
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              onChange={e => editor.chain().focus().setBackgroundColor(e.target.value).run()} />
          </label>

          <Divider />

          {/* Link */}
          <ToolBtn
            onClick={() => {
              const url = window.prompt('Link URL:')
              if (url) editor.chain().focus().setLink({ href: url }).run()
            }}
            active={editor.isActive('link')} title="Add link">🔗</ToolBtn>
          {editor.isActive('link') && (
            <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">🔗✕</ToolBtn>
          )}

          {/* Image via media library */}
          <ToolBtn onClick={() => setMediaOpen(true)} title="Insert image from Media Library" active={false}>🖼</ToolBtn>

          {/* Table insert */}
          <ToolBtn
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="Insert 3×3 table" active={inTable}>⊞ Table</ToolBtn>

          <Divider />

          <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolBtn>
        </div>

        {/* ── Table properties bar (shows when cursor is inside a table) ── */}
        {inTable && (
          <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 bg-amber-50 border-b border-amber-100">
            <span className="text-xs font-semibold text-amber-700 mr-1 flex-shrink-0">⊞ Table:</span>

            {/* Cell background color */}
            <label className="relative flex-shrink-0 flex items-center gap-1 px-2 py-0.5 border border-amber-300 rounded bg-white hover:bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer" title="Cell background color">
              🎨 Cell BG
              <input type="color" defaultValue="#fffde7"
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                onChange={e => editor.chain().focus().setCellAttribute('backgroundColor', e.target.value).run()} />
            </label>

            {/* Cell border color */}
            <label className="relative flex-shrink-0 flex items-center gap-1 px-2 py-0.5 border border-amber-300 rounded bg-white hover:bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer" title="Cell border color">
              🖊 Border Color
              <input type="color" defaultValue="#94a3b8"
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                onChange={e => editor.chain().focus().setCellAttribute('borderColor', e.target.value).run()} />
            </label>

            {/* Cell border size */}
            <select title="Cell border size"
              defaultValue="1"
              onChange={e => editor.chain().focus().setCellAttribute('borderWidth', e.target.value).run()}
              className="text-xs border border-amber-300 rounded px-1 py-0.5 bg-white text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400">
              <option value="0">0px</option>
              <option value="1">1px</option>
              <option value="2">2px</option>
              <option value="3">3px</option>
              <option value="4">4px</option>
              <option value="5">5px</option>
            </select>

            <span className="w-px h-4 bg-amber-200 mx-0.5" />

            <ToolBtn onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add column before" active={false}>←+Col</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column after" active={false}>+Col→</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column" active={false}>✕Col</ToolBtn>

            <span className="w-px h-4 bg-amber-200 mx-0.5" />

            <ToolBtn onClick={() => editor.chain().focus().addRowBefore().run()} title="Add row above" active={false}>↑+Row</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row below" active={false}>+Row↓</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row" active={false}>✕Row</ToolBtn>

            <span className="w-px h-4 bg-amber-200 mx-0.5" />

            <ToolBtn onClick={() => editor.chain().focus().mergeOrSplit().run()} title="Merge or split selected cells" active={false}>⊠ Merge/Split</ToolBtn>

            <span className="w-px h-4 bg-amber-200 mx-0.5" />

            <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}
              className="px-1.5 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 flex-shrink-0" title="Delete entire table">
              🗑 Delete Table
            </button>
          </div>
        )}

        {/* ── Editor area ── */}
        <EditorContent editor={editor}
          className={[
            'min-h-[320px] max-h-[560px] overflow-y-auto p-4 bg-white text-sm',
            '[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[300px]',
            '[&_.ProseMirror_p]:mb-2',
            '[&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:mt-5 [&_.ProseMirror_h1]:mb-2',
            '[&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
            '[&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
            '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:ml-5 [&_.ProseMirror_ul]:mb-2',
            '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:ml-5 [&_.ProseMirror_ol]:mb-2',
            '[&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline',
            '[&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded [&_.ProseMirror_img]:my-2',
            '[&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:my-3',
            '[&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-gray-300 [&_.ProseMirror_td]:p-2 [&_.ProseMirror_td]:min-w-[60px] [&_.ProseMirror_td]:align-top',
            '[&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-gray-400 [&_.ProseMirror_th]:p-2 [&_.ProseMirror_th]:bg-gray-100 [&_.ProseMirror_th]:font-semibold',
            '[&_.ProseMirror_.selectedCell]:outline [&_.ProseMirror_.selectedCell]:outline-2 [&_.ProseMirror_.selectedCell]:outline-offset-[-2px] [&_.ProseMirror_.selectedCell]:outline-indigo-400',
          ].join(' ')}
        />
      </div>
    </>
  )
}
