import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import { useTodoStore } from '@/store/todoStore';
import type { WidgetRenderProps } from '@/registry/types';

export function TodoWidget({ widget }: WidgetRenderProps) {
  const items = useTodoStore((s) => s.items);
  const add = useTodoStore((s) => s.add);
  const toggle = useTodoStore((s) => s.toggle);
  const remove = useTodoStore((s) => s.remove);
  const [text, setText] = useState('');

  return (
    <WidgetFrame widget={widget} title="To-Do">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add(text.trim());
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task"
          className="hud-input flex-1"
        />
        <button type="submit" className="hud-btn-primary px-3">
          Add
        </button>
      </form>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-2">
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => toggle(item.id)}
              className="h-5 w-5 accent-cyan-400"
            />
            <span className={cn('flex-1 text-sm', item.done && 'text-white/35 line-through')}>{item.text}</span>
            <button type="button" className="p-1 text-white/35" onClick={() => remove(item.id)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-white/40">Inbox zero.</li> : null}
      </ul>
    </WidgetFrame>
  );
}
