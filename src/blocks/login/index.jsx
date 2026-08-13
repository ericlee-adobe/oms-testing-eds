import { createRoot } from 'react-dom/client';
import LoginForm from './LoginForm.jsx';

export default function decorate(block) {
    const root = document.createElement('div');

    block.replaceChildren(root);

    createRoot(root).render(<LoginForm block={block} />);
}