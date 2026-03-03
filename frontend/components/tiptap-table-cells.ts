// Custom Tiptap TableCell and TableHeader extensions
// Extends the base extensions with backgroundColor and borderColor
// attributes that render as inline styles, enabling setCellAttribute() to work.

import { TableCell, TableHeader } from '@tiptap/extension-table'

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {}
          return { style: `background-color: ${attributes.backgroundColor};` }
        },
      },
      borderColor: {
        default: null,
        parseHTML: element => element.style.borderColor || null,
        renderHTML: attributes => {
          if (!attributes.borderColor) return {}
          return { style: `border-color: ${attributes.borderColor}; border-style: solid;` }
        },
      },
    }
  },
})

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {}
          return { style: `background-color: ${attributes.backgroundColor};` }
        },
      },
      borderColor: {
        default: null,
        parseHTML: element => element.style.borderColor || null,
        renderHTML: attributes => {
          if (!attributes.borderColor) return {}
          return { style: `border-color: ${attributes.borderColor}; border-style: solid;` }
        },
      },
    }
  },
})
