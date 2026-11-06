import { useState } from 'react';
import PatientForm from '../../components/PatientForm';
import { api, type NewPatient, type Patient } from '../../data';
import './tabs.css';

export default function ProfileTab({ patient, onSaved }: { patient: Patient; onSaved: (p: Patient) => void }) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { id: _id, createdAt, ...initial } = patient;

  return (
    <section className="panel tab-panel tab-narrow">
      <div className="tab-head">
        <h2>Profile</h2>
        <span className="tab-muted">Created {new Date(createdAt).toLocaleDateString()}</span>
      </div>
      <PatientForm
        key={patient.id}
        initial={initial}
        submitLabel="Save changes"
        onSubmit={async (p: NewPatient) => {
          const updated = await api.updatePatient(patient.id, p);
          onSaved(updated);
          setSavedAt(Date.now());
        }}
      />
      <p className="tab-saved" aria-live="polite">{savedAt ? 'Changes saved.' : ''}</p>
    </section>
  );
}
