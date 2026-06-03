export function WelcomeInformationSummary() {
  return (
    <>
      <div className="consent-purpose">
        <p>
          Keräämme lyhyitä suomenkielisiä ääninäytteitä kehittääksemme lyhytvastausten
          puheentunnistusta Linnean tekoälypohjaista puhelinpalvelua varten.
        </p>
        <p>
          We collect short Finnish voice samples to improve short-response speech
          recognition for Linnea's AI-based phone service.
        </p>
      </div>

      <section className="consent-steps" aria-labelledby="consent-steps-title-fi">
        <div>
          <h2 id="consent-steps-title-fi">Mitä osallistuminen tarkoittaa?</h2>
          <ol>
            <li>Vastaat muutamaan lyhyeen taustakysymykseen tallennusolosuhteista.</li>
            <li>Nauhoitat lyhyitä suomenkielisiä sanoja tai vastauksia.</li>
            <li>
              Osallistuminen vie yleensä vain muutaman minuutin, ja voit lopettaa
              milloin tahansa.
            </li>
          </ol>
        </div>

        <div>
          <h2>What will you do?</h2>
          <ol>
            <li>Answer a few short background questions about the recording conditions.</li>
            <li>Record short Finnish words or responses.</li>
            <li>Participation usually takes only a few minutes, and you can stop at any time.</li>
          </ol>
        </div>
      </section>

      <section className="consent-summary-note" aria-labelledby="consent-summary-title">
        <h2 id="consent-summary-title">Tietosuoja ja suostumus / Privacy and consent</h2>
        <p>
          Osallistuminen on vapaaehtoista. Emme pyydä nimeäsi, sähköpostiosoitettasi
          tai puhelinnumeroasi osallistumisen aikana. Jatkamalla vahvistat, että olet
          vähintään 18-vuotias ja annat suostumuksesi ääninäytteiden käyttämiseen yllä
          kuvattuun tarkoitukseen.
        </p>
        <p>
          Participation is voluntary. We do not ask for your name, email address, or
          phone number during participation. By continuing, you confirm that you are at
          least 18 years old and consent to the use of your voice samples for the
          purpose described above.
        </p>
        <a className="consent-read-more-link" href="/#/privacy">
          Lue tietosuoja- ja suostumustiedot kokonaan / Read full privacy and consent details
        </a>
      </section>
    </>
  );
}
