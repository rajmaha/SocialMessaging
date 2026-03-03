'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'

const MERGE_TAGS = [
  { label: 'First Name', tag: '{{first_name}}' },
  { label: 'Last Name', tag: '{{last_name}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Unsubscribe', tag: '{{unsubscribe_link}}' },
]

interface EmailEditorProps {
  content: string
  onChange: (html: string) => void
}

function ToolBtn({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

export default function EmailEditor({ content, onChange }: EmailEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: content || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync when external content changes (e.g. template selected)
  useEffect(() => {
    if (!editor || !content) return
    if (editor.getHTML() === content) return
    editor.commands.setContent(content, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  if (!editor) return null

  const div = <span className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
      {/* Merge tag toolbar */}
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

      {/* Formatting toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <em>I</em>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strike">
          <s>S</s>
        </ToolBtn>
        {div}
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="H2">H2</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="H3">H3</ToolBtn>
        {div}
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolBtn>
        {div}
        <ToolBtn
          onClick={() => {
            const url = window.prompt('Link URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Add link"
        >🔗</ToolBtn>
        {editor.isActive('link') && (
          <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">🔗✕</ToolBtn>
        )}
        {div}
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolBtn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className={[
          'min-h-[300px] max-h-[500px] overflow-y-auto p-4 bg-white text-sm',
          '[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[280px]',
          '[&_.ProseMirror_p]:mb-2',
          '[&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
          '[&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
          '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:ml-5 [&_.ProseMirror_ul]:mb-2',
          '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:ml-5 [&_.ProseMirror_ol]:mb-2',
          '[&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline',
        ].join(' ')}
      />
    </div>
  )
}
