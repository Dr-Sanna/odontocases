import PageTitle from '../components/PageTitle';
import Background from '../components/Background';

export default function Documentation() {
  return (
    <>
      <Background variant="secondary" />

      <div className="page-header">
        <div className="container">
          <PageTitle description="Accède à des fiches synthétiques et structurées pour réviser la pathologie orale plus efficacement.">
            Documentation
          </PageTitle>
        </div>
      </div>

      <div className="container">
        {/* contenu à venir */}
      </div>
    </>
  );
}
