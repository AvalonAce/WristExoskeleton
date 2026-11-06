// Step 1 stub: lists patients from the data layer. Create/edit form comes in step 2.
import { useEffect, useState } from 'react';
import { api, type Patient } from '../data';

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[] | null>(null);

  useEffect(() => {
    api.listPatients().then(setPatients);
  }, []);

  if (!patients) return <p>Loading...</p>;
  return (
    <section>
      <h1>Patients</h1>
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Side</th><th>Spring</th><th>ROM goal (flex / ext)</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.displayName}</td>
              <td>{p.side}</td>
              <td>{p.springSetting}</td>
              <td>{p.romGoalFlexDeg}° / {p.romGoalExtDeg}°</td>
              <td>{p.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
