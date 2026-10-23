import { Folder } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell';
import { assets } from '@/lib/mock';

export default function Assets() {
  return (
    <>
      <PageHeader title="Asset Library" description="Every creative, video and raw upload, stored on our Coolify server (MinIO), sorted by month and platform. Daily backup." />
      <Input placeholder="Search by topic, platform, person, date or status..." className="mb-6 max-w-md bg-background" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((a) => (
          <Card key={a.folder}>
            <CardContent className="flex items-center gap-3 pt-5">
              <Folder className="size-8 text-[#E8B04B]" />
              <div>
                <div className="text-sm font-medium">/{a.folder}/</div>
                <div className="text-xs text-muted-foreground">{a.files} files · {a.size}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
