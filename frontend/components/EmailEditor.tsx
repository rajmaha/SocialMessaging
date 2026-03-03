'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { useEffect, useRef } from 'react'

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
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-1.5 py-1 rounded text-sm font-medium transition-colors flex-shrink-0 ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

export default function EmailEditor({ content, onChange }: EmailEditorProps) {
  const textColorRef = useRef<HTMLInputElement>(null)
  const bgColorRef   = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyleKit,
      Image.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ resizable: true }),
    ],
    content: content || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync when external content changes (template selected)
  useEffect(() => {
    if (!editor || !content) return
    if (editor.getHTML() === content) return
    editor.commands.setContent(content, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  if (!editor) return null

  const insertImage = () => {
    const url = window.prompt('Image URL:')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">

      {/* ── Merge tag bar ── */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-indigo-50 border-b border-indigo-100">
        <span className="text-xs font-semibold text-indigo-600 mr-1 flex-shrink-0">Insert:</span>
        {MERGE_TAGS.map(({ label, tag }) => (
          <button
            key={tag}
            type="button"
            onClick={() => editor.chain().focus().insertContent(tag).run()}
            title={label}
            className="px-2 py-0.5 bg-white border border-indigo-200 rounded text-xs text-indigo-700 hover:bg-indigo-100 font-mono transition-colors"
          >
            {tag}
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">

        {/* Font family */}
        <select
          title="Font Family"
          onChange={e => {
            const v = e.target.value
            if (v) editor.chain().focus().setFontFamily(v).run()
            else editor.chain().focus().unsetFontFamily().run()
          }}
          className="text-xs border border-gray-300 rounded px-1 py-0.5 mr-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <Divider />

        {/* Bold / Italic / Strike */}
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <em>I</em>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <s>S</s>
        </ToolBtn>

        <Divider />

        {/* Headings */}
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">H1</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</ToolBtn>

        <Divider />

        {/* Alignment */}
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">⬅</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center">≡</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">➡</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">☰</ToolBtn>

        <Divider />

        {/* Lists */}
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolBtn>

        <Divider />

        {/* Text color */}
        <div className="relative flex-shrink-0" title="Text color">
          <button
            type="button"
            onClick={() => textColorRef.current?.click()}
            className="flex flex-col items-center px-1.5 py-0.5 rounded hover:bg-gray-100"
          >
            <span className="text-xs font-bold leading-tight" style={{ color: editor.getAttributes('textStyle').color || '#000' }}>A</span>
            <span className="w-4 h-1 rounded-sm mt-0.5" style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000' }} />
          </button>
          <input ref={textColorRef} type="color" defaultValue="#000000"
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
            onChange={e => editor.chain().focus().setColor(e.target.value).run()}
          />
        </div>

        {/* Background / highlight color */}
        <div className="relative flex-shrink-0" title="Highlight color">
          <button
            type="button"
            onClick={() => bgColorRef.current?.click()}
            className="flex flex-col items-center px-1.5 py-0.5 rounded hover:bg-gray-100"
          >
            <span className="text-xs font-bold leading-tight text-gray-700">A̲</span>
            <span className="w-4 h-1 rounded-sm mt-0.5 border border-gray-300" style={{ backgroundColor: '#FBBF24' }} />
          </button>
          <input ref={bgColorRef} type="color" defaultValue="#FBBF24"
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
            onChange={e => editor.chain().focus().setBackgroundColor(e.target.value).run()}
          />
        </div>

        <Divider />

        {/* Link */}
        <ToolBtn
          onClick={() => {
            const url = window.prompt('Link URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')} title="Add link"
        >🔗</ToolBtn>
        {editor.isActive('link') && (
          <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">🔗✕</ToolBtn>
        )}

        {/* Image */}
        <ToolBtn onClick={insertImage} title="Insert image" active={false}>🖼</ToolBtn>

        {/* Table */}
        <ToolBtn onClick={insertTable} title="Insert 3×3 table" active={editor.isActive('table')}>⊞</ToolBtn>
        {editor.isActive('table') && (
          <>
            <ToolBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column">+Col</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row">+Row</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table">🗑</ToolBtn>
          </>
        )}

        <Divider />

        <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolBtn>
      </div>

      {/* ── Editor area ── */}
      <EditorContent
        editor={editor}
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
          '[&_.ProseMirror_.selectedCell]:bg-indigo-50',
        ].join(' ')}
      />
    </div>
  )
}
