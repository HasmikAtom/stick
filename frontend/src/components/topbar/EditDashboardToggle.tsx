import { useLocation } from 'react-router-dom';
import { Pencil, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useDashboard } from '@/components/dashboard';

export function EditDashboardToggle() {
  const { pathname } = useLocation();
  const { isEditing, beginEdit, cancelEdit, saveEdit } = useDashboard();
  const { toast } = useToast();

  // Only relevant on the home/dashboard route.
  if (pathname !== '/') return null;

  const onSave = async () => {
    try {
      await saveEdit();
      toast({ title: 'Dashboard saved' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  if (!isEditing) {
    return (
      <Button variant="ghost" size="sm" onClick={beginEdit}>
        <Pencil className="h-4 w-4 mr-1" />
        Edit
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={cancelEdit}>
        <X className="h-4 w-4 mr-1" />
        Cancel
      </Button>
      <Button size="sm" onClick={onSave}>
        <Save className="h-4 w-4 mr-1" />
        Save
      </Button>
    </div>
  );
}
