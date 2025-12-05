import PageTitle from '../components/PageTitle';
import Background from '../components/Background';

export default function Randomisation() {
  return (
    <>
      <Background variant="secondary" />

      <div className="page-header">
        <div className="container">
          <PageTitle description="Génère des cas aléatoires pour t’entraîner au diagnostic, te chronométrer et varier les situations cliniques.">
            Randomisation
          </PageTitle>
        </div>
      </div>

      <div className="container">
        {/* contenu à venir */}
      </div>
    </>
  );
}
