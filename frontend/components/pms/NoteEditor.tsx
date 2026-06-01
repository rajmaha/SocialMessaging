'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

export default function NoteEditor({
  onChange,
  placeholder = 'Add a note...',
  minHeight = '72px',
}: {
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
  });

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, title: string, label: React.ReactNode) => (
    <button type="button" title={title} onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`px-1.5 py-0.5 rounded text-xs font-medium leading-none transition-colors ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-200'
      }`}>
      {label}
    </button>
  );

  return (
    <div className="border border-gray-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-indigo-400 focus-within:border-indigo-400">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-gray-200 bg-gray-50">
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold', <b>B</b>)}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic', <i>I</i>)}
        {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'Strikethrough', <s>S</s>)}
        <span className="w-px h-3.5 bg-gray-200 mx-0.5" />
        {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bullet list', '• ≡')}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list', '1 ≡')}
        <span className="w-px h-3.5 bg-gray-200 mx-0.5" />
        {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Blockquote', '" "')}
        {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), 'Code block', '</>')}
      </div>
      <EditorContent
        editor={editor}
        className="pms-note-editor text-sm px-2.5 py-2 max-h-[160px] overflow-y-auto"
        style={{ minHeight }}
      />
    </div>
  );
}
