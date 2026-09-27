import { AdminPage } from "../../../admin-page";
import { IngestUploads } from "../../../ingest-uploads";

export default async function UploadsPage() {
  return (
    <AdminPage title="Uploads" description="One upload for every exchange and dataset. The file type comes from the file, and only commission batches can change cashback.">
      <IngestUploads />
    </AdminPage>
  );
}
