const CONTACT_EMAIL = "ollipekka@hellolinnea.com";

function PolicyHeader({ compatibilityNote }: { compatibilityNote?: string }) {
  return (
    <header className="policy-header">
      <span className="app-eyebrow">Linnea Technologies Oy</span>
      <h1 className="app-title">Tietosuoja- ja suostumustiedot</h1>
      <p className="consent-title-translation">Privacy and consent details</p>
      <p className="app-copy">
        Päivitetty 03.06.2026. Suomenkielinen teksti on virallinen osallistujille
        näytettävä sisältö; englanninkielinen teksti on apukäännös.
      </p>
      {compatibilityNote && <p className="policy-route-note">{compatibilityNote}</p>}
      <a className="policy-back-link" href="#/">
        Back to participation
      </a>
    </header>
  );
}

function FullPrivacyDetailsPage({ compatibilityNote }: { compatibilityNote?: string }) {
  return (
    <section className="app-panel app-panel--wide policy-page">
      <PolicyHeader compatibilityNote={compatibilityNote} />

      <div className="policy-language-block">
        <h2>Suomi</h2>

        <section>
          <h3>Tietosuojaseloste</h3>
          <p>Linnea Technologies Oy - Puheentunnistuksen kehittämistutkimus</p>
          <p>Päivitetty: 03.06.2026</p>
        </section>

        <section>
          <h3>1. Rekisterinpitäjä</h3>
          <p>
            Linnea Technologies Oy
            <br />
            Y-tunnus: 3571288-4
            <br />
            Kulmalantie 11 as. 2
            <br />
            28130 Pori
            <br />
            Finland
            <br />
            Sähköposti: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <section>
          <h3>2. Yhteyshenkilö rekisteriasioissa</h3>
          <p>
            Ollipekka Kivin
            <br />
            Sähköposti: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <section>
          <h3>3. Rekisterin nimi</h3>
          <p>Puheentunnistuksen kehittämistutkimuksen ääniaineisto.</p>
        </section>

        <section>
          <h3>4. Henkilötietojen käsittelyn tarkoitus ja oikeusperuste</h3>
          <p>
            Keräämme ääninäytteitä suomenkielisten lyhytvastauksien puheentunnistuksen
            kehittämistä varten. Aineistoa käytetään Linnea Technologies Oy:n
            kehittämän tekoälypohjaisen puhelinpalvelun kehittämiseen.
          </p>
          <p>
            GDPR:n mukainen käsittelyperuste on rekisteröidyn antama suostumus (GDPR
            6 artikla 1 kohta a).
          </p>
        </section>

        <section>
          <h3>5. Kerättävät tiedot</h3>
          <p>Kerätään seuraavat tiedot:</p>
          <ul>
            <li>Ääninäytteet, kuten lyhyet sanavastauksien toistot.</li>
            <li>
              Tekninen tunnistekoodi, joka yhdistää saman käyttäjän eri nauhoitukset
              toisiinsa pseudonyymisti.
            </li>
            <li>Vapaaehtoisesti annetut taustatiedot ja tallennusolosuhteiden tiedot.</li>
            <li>
              Perustason selain-, laite- ja mikrofonitiedot tallennuksen laadun
              arvioimiseksi.
            </li>
          </ul>
          <p>
            Ääninäytteisiin ei yhdistetä nimeä, sähköpostiosoitetta tai muita suoria
            tunnistetietoja. Tekninen tunnistekoodi ei itsessään paljasta
            henkilöllisyyttä.
          </p>
        </section>

        <section>
          <h3>6. Tietojen säilytysaika</h3>
          <p>
            Ääninäytteitä ja niihin liittyviä tietoja säilytetään toistaiseksi
            tutkimus- ja kehityskäyttöä varten. Aineisto poistetaan, jos organisaatio
            lakkaa toimintansa tai rekisteröity peruuttaa suostumuksensa.
          </p>
          <p>
            Pseudonyymiä tunnistekoodia käyttäen rekisteröity voi pyytää omien
            tietojensa poistamista.
          </p>
        </section>

        <section>
          <h3>7. Tietojen vastaanottajat ja siirrot</h3>
          <p>
            Tietoja ei luovuteta kolmansille osapuolille kaupallisiin tarkoituksiin.
            Aineistoa saatetaan käsitellä alihankkijana toimivien teknisten
            palveluntarjoajien järjestelmissä, kuten pilvipalvelussa,
            tietosuojasopimuksen nojalla.
          </p>
          <p>
            Tietoja käsitellään ainoastaan EU- tai ETA-alueella. Tietoja ei siirretä
            EU:n tai ETA:n ulkopuolelle.
          </p>
        </section>

        <section>
          <h3>8. Tekniset ja organisatoriset suojatoimet</h3>
          <ul>
            <li>Tiedot siirretään ja tallennetaan salattuna HTTPS/TLS-yhteydellä.</li>
            <li>Pääsy aineistoon on rajattu Linnea Technologies Oy:n kehitystiimille.</li>
            <li>
              Teknistä tunnistekoodia ja mahdollisia taustatietoja käsitellään
              pseudonyymisti.
            </li>
          </ul>
        </section>

        <section>
          <h3>9. Rekisteröidyn oikeudet</h3>
          <p>Rekisteröidyllä on GDPR:n nojalla seuraavat oikeudet:</p>
          <ul>
            <li>Oikeus saada vahvistus siitä, käsitelläänkö häntä koskevia tietoja.</li>
            <li>Oikeus saada pääsy omiin tietoihinsa.</li>
            <li>Oikeus pyytää tietojen oikaisemista tai poistamista.</li>
            <li>
              Oikeus peruuttaa suostumus milloin tahansa. Tämä ei vaikuta ennen
              peruuttamista suoritetun käsittelyn lainmukaisuuteen.
            </li>
            <li>Oikeus tehdä valitus valvontaviranomaiselle.</li>
          </ul>
          <p>
            Koska tietoja käsitellään pseudonyymisti teknisen tunnistekoodin avulla,
            rekisteröidyltä voidaan pyytää riittävät tiedot oman aineistonsa
            löytämiseksi. Oikeuksien käyttämistä koskevat pyynnöt lähetetään
            osoitteeseen <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <section>
          <h3>10. Valvontaviranomainen</h3>
          <p>
            Rekisteröidyllä on oikeus tehdä valitus tietosuojavaltuutetulle, jos hän
            katsoo, että häntä koskevien henkilötietojen käsittelyssä on rikottu
            tietosuoja-asetusta.
          </p>
          <p>
            Tietosuojavaltuutetun toimisto
            <br />
            PL 800, 00521 Helsinki
            <br />
            tietosuoja@om.fi
            <br />
            <a href="https://tietosuoja.fi">https://tietosuoja.fi</a>
          </p>
        </section>

        <section>
          <h3>Tietoon perustuva suostumus</h3>
          <p>
            Osallistut tutkimukseen, jossa kerätään ääninäytteitä suomenkielisten
            lyhytvastausten tunnistamisen kehittämistä varten. Nauhoituksia käytetään
            Linnea Technologies Oy:n tekoälypohjaisen puhelinpalvelun kehittämiseen.
          </p>
        </section>

        <section>
          <h3>Mitä osallistuminen tarkoittaa?</h3>
          <p>
            Sinulle näytetään näytöllä lyhyitä sanoja, kuten "joo", "ei" tai
            "kyllä". Sinua pyydetään toistamaan ja nauhoittamaan nämä sanat
            mikrofonin kautta. Nauhoittaminen vie yleensä vain muutaman minuutin.
          </p>
        </section>

        <section>
          <h3>Mitä tietoja kerätään?</h3>
          <ul>
            <li>Ääninäytteet.</li>
            <li>Tekninen tunnistekoodi, joka käsitellään pseudonyymisti.</li>
            <li>Vapaaehtoisesti annetut taustatiedot ja tallennusolosuhteiden tiedot.</li>
          </ul>
          <p>
            Nauhoituksia ei yhdistetä nimeesi tai sähköpostiisi. Tietoja käsitellään
            EU/ETA-alueella.
          </p>
        </section>

        <section>
          <h3>Osallistuminen on vapaaehtoista</h3>
          <p>
            Voit keskeyttää osallistumisen milloin tahansa sulkemalla selaimen. Voit
            myös myöhemmin pyytää tietojesi poistamista tai peruuttaa suostumuksesi
            ottamalla yhteyttä osoitteeseen{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <section>
          <h3>Vahvistus</h3>
          <p>Jatkamalla osallistumista vahvistat, että:</p>
          <ul>
            <li>Olet lukenut kuvauksen tutkimuksesta.</li>
            <li>Ymmärrät, mitä tietoja kerätään ja mihin niitä käytetään.</li>
            <li>Osallistut vapaaehtoisesti.</li>
            <li>Olet täysi-ikäinen eli 18 vuotta tai vanhempi.</li>
            <li>Olet lukenut tietosuojaselosteen ja hyväksyt tietojen keräämisen kuvatulla tavalla.</li>
          </ul>
        </section>

        <section>
          <h3>Ikärajahuomio - alle 18-vuotiaat</h3>
          <p>
            Tämä tutkimus on tarkoitettu vain täysi-ikäisille eli 18 vuotta
            täyttäneille. Jos et ole vielä 18-vuotias, et voi osallistua tutkimukseen.
          </p>
          <p>
            Tämä ikärajaehto on pakollinen, koska emme kerää alaikäisten ääninäytteitä
            ilman vanhemman tai huoltajan nimenomaista kirjallista suostumusta.
          </p>
        </section>

        <section>
          <h3>Tutkimustiedote</h3>
          <p>
            Linnea Technologies Oy kehittää tekoälypohjaista puhelinpalvelua, joka
            auttaa organisaatioita vastaamaan asiakaspuheluihin. Järjestelmä tunnistaa
            asiakkaan vastauksia, kuten "kyllä" tai "ei", ja tarvitsee harjoitusdataa
            toimiakseen luotettavasti.
          </p>
          <p>
            Tutkimuksen tavoitteena on kerätä laaja ja monimuotoinen kokoelma
            suomenkielisiä lyhyitä äänivastauksia, joita käytetään puheentunnistuksen
            kehittämiseen.
          </p>
        </section>

        <section>
          <h3>Kuka voi osallistua?</h3>
          <ul>
            <li>Täysi-ikäiset henkilöt eli 18-vuotiaat tai vanhemmat.</li>
            <li>Suomen kielen puhujat.</li>
            <li>Henkilöt, joilla on pääsy mikrofonilla varustettuun laitteeseen.</li>
          </ul>
        </section>

        <section>
          <h3>Miten osallistuminen tapahtuu?</h3>
          <p>
            Osallistuminen tapahtuu selaimen kautta tutkimussivustolla. Sinulle
            näytetään lyhyitä suomenkielisiä sanoja, jotka toistat ääneen.
            Nauhoittaminen vie yleensä vain muutaman minuutin.
          </p>
        </section>

        <section>
          <h3>Onko osallistuminen anonyymia?</h3>
          <p>
            Osallistuminen on pseudonyymistä. Sisäinen tekninen tunniste yhdistää omat
            nauhoituksesi toisiinsa, mutta ei paljasta henkilöllisyyttäsi meille. Emme
            kerää nimeäsi tai sähköpostiosoitettasi. Voit antaa vapaaehtoisesti
            taustatietoja tutkimusdatan laadun parantamiseksi.
          </p>
        </section>

        <section>
          <h3>Yhteystiedot</h3>
          <p>
            Lisätietoja tutkimuksesta antaa Ollipekka Kivin, Linnea Technologies Oy,{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Tietosuojaseloste
            on saatavilla tutkimussivustolla.
          </p>
        </section>
      </div>

      <div className="policy-language-block policy-language-block--helper">
        <h2>English Helper Translation</h2>

        <section>
          <h3>Privacy Notice</h3>
          <p>
            Linnea Technologies Oy is the data controller for the speech-recognition
            development study. The company collects short Finnish voice samples to
            improve short-response speech recognition for Linnea's AI-based phone
            service.
          </p>
          <p>
            The legal basis is consent under GDPR Article 6(1)(a). The collection does
            not ask for a participant's name, email address, or phone number during the
            volunteer flow.
          </p>
        </section>

        <section>
          <h3>Controller And Contact</h3>
          <p>
            Linnea Technologies Oy, business ID 3571288-4, Kulmalantie 11 as. 2, 28130
            Pori, Finland. Contact person: Ollipekka Kivin,{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <section>
          <h3>Data Collected</h3>
          <ul>
            <li>Short voice samples.</li>
            <li>A pseudonymous technical identifier for grouping recordings.</li>
            <li>Voluntary background and recording-environment information.</li>
            <li>Basic browser, device, and microphone information for quality review.</li>
          </ul>
          <p>
            Recordings are not connected to a name or email address. Data is processed
            in the EU/EEA and is not disclosed to third parties for commercial purposes.
          </p>
        </section>

        <section>
          <h3>Participation And Consent</h3>
          <p>
            Participation is voluntary. Participants record short Finnish words or
            responses in the browser and may stop at any time. Only people who are 18
            years or older may participate in this app version.
          </p>
          <p>
            Participants may request access, correction, deletion, or withdrawal of
            consent by contacting{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Withdrawal does not
            affect processing that happened lawfully before withdrawal.
          </p>
        </section>

        <section>
          <h3>Research Information</h3>
          <p>
            Linnea Technologies Oy develops an AI-based phone service that helps
            organizations handle customer calls. The study collects a broad and varied
            set of short Finnish spoken responses to improve speech recognition.
          </p>
        </section>
      </div>
    </section>
  );
}

export function PrivacyPolicyPage() {
  return <FullPrivacyDetailsPage />;
}

export function ParticipantInfoPage() {
  return (
    <FullPrivacyDetailsPage compatibilityNote="This compatibility route shows the same full privacy and consent details as /#/privacy." />
  );
}
