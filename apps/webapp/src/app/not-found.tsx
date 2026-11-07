import { EmptyState } from '@/components/ui/EmptyState';
export default function NotFound() {
  return (
    <EmptyState
      title="Not found"
      description="This item does not exist or belongs to another organization."
    />
  );
}
