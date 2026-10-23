import { PageHeader } from '@/components/shell';
import { UploadStudio } from './studio';

export default function Upload() {
  return (
    <>
      <PageHeader title="Upload Studio" description="Turn your raw photos and clips into posts, stories and reels for many platforms at once." />
      <UploadStudio />
    </>
  );
}
