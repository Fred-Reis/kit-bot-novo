import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  test('renders count', () => {
    render(<Badge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('renders 99+ when count exceeds 99', () => {
    render(<Badge count={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  test('renders 99 without plus at exactly 99', () => {
    render(<Badge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  test('renders nothing when count is 0', () => {
    const { container } = render(<Badge count={0} />);
    expect(container.firstChild).toBeNull();
  });
});
