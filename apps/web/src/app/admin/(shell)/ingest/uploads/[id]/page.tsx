import { AdminPage } from "../../../../admin-page";
import { BatchPreview } from "../../../../ingest-uploads";

export default async function UploadPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminPage title="Upload preview" description="Review validation and drift warnings, then publish. Publishing a commission batch can change cashback. Referral activity cannot.">
      <BatchPreview id={id} />
    </AdminPage>
  );
}
