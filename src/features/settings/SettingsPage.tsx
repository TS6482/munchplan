import { useState } from 'react';
import { useSessionStore } from '../../store/session';
import { useDataStore } from '../../store/data';
import type { DietRule, Person } from '../../types';
import {
  blockedListAdd,
  blockedListRemove,
  parseRepoInput,
  parseRotationWeeks,
  validateConfig,
  validateDietRule,
  type ConfigErrors,
} from './settingsLogic';
import styles from './SettingsPage.module.css';

function maskToken(token: string): string {
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}

function RepoSection() {
  const owner = useSessionStore((s) => s.owner);
  const repo = useSessionStore((s) => s.repo);
  const token = useSessionStore((s) => s.token);
  const configured = useSessionStore((s) => s.configured);
  const setConfig = useSessionStore((s) => s.setConfig);
  const clearConfig = useSessionStore((s) => s.clearConfig);
  const loadAll = useDataStore((s) => s.loadAll);
  const resetData = useDataStore((s) => s.reset);

  const [ownerInput, setOwnerInput] = useState(owner);
  const [repoInput, setRepoInput] = useState(repo);
  const [tokenInput, setTokenInput] = useState('');
  const [errors, setErrors] = useState<ConfigErrors>({});

  function handleRepoChange(value: string) {
    const parsed = parseRepoInput(value);
    if (parsed.owner) {
      setOwnerInput(parsed.owner);
      setRepoInput(parsed.repo);
    } else {
      setRepoInput(value);
    }
  }

  function handleSave() {
    const result = validateConfig({ owner: ownerInput, repo: repoInput, token: tokenInput });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const cfg = { owner: ownerInput.trim(), repo: repoInput.trim(), token: tokenInput.trim() };
    setConfig(cfg.owner, cfg.repo, cfg.token);
    void loadAll(cfg);
  }

  function handleDisconnect() {
    clearConfig();
    resetData();
  }

  if (configured) {
    return (
      <section className={styles.section}>
        <h2>Datový repozitář</h2>
        <p>
          {owner}/{repo}
        </p>
        <p>Token: {maskToken(token)}</p>
        <button type="button" className="btn btnDanger" onClick={handleDisconnect}>
          Odpojit
        </button>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2>Datový repozitář</h2>
      <label className={styles.field}>
        Vlastník
        <input value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} />
      </label>
      {errors.owner && <p className={styles.error}>{errors.owner}</p>}
      <label className={styles.field}>
        Repozitář
        <input value={repoInput} onChange={(e) => handleRepoChange(e.target.value)} />
      </label>
      {errors.repo && <p className={styles.error}>{errors.repo}</p>}
      <label className={styles.field}>
        Token
        <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
      </label>
      {errors.token && <p className={styles.error}>{errors.token}</p>}
      <p className={styles.hint}>Token je uložen jen v tomto zařízení</p>
      <button type="button" className="btn btnPrimary" onClick={handleSave}>
        Uložit
      </button>
    </section>
  );
}

interface PersonCardProps {
  idx: 0 | 1;
  person: Person;
  setPersonName: (idx: 0 | 1, name: string) => Promise<void>;
  setBlockedList: (idx: 0 | 1, blocked: string[]) => Promise<void>;
}

function PersonCard({ idx, person, setPersonName, setBlockedList }: PersonCardProps) {
  const [name, setName] = useState(person.name);
  const [lastSyncedName, setLastSyncedName] = useState(person.name);
  const [blockedInput, setBlockedInput] = useState('');

  // Adjust local state during render when the store's name changes externally
  // (e.g. after the initial async load) — see React docs on adjusting state
  // when a prop changes, instead of syncing via a useEffect.
  if (person.name !== lastSyncedName) {
    setLastSyncedName(person.name);
    setName(person.name);
  }

  function handleNameBlur() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== person.name) void setPersonName(idx, trimmed);
  }

  function handleAddBlocked() {
    const updated = blockedListAdd(person.blocked, blockedInput);
    if (updated !== person.blocked) void setBlockedList(idx, updated);
    setBlockedInput('');
  }

  function handleRemoveBlocked(item: string) {
    void setBlockedList(idx, blockedListRemove(person.blocked, item));
  }

  return (
    <div className={styles.personCard}>
      <input
        className={styles.personName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleNameBlur}
      />
      <ul className={styles.chipList}>
        {person.blocked.map((item) => (
          <li key={item} className={styles.chip}>
            {item}
            <button type="button" onClick={() => handleRemoveBlocked(item)} aria-label={`Odebrat ${item}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.chipForm}>
        <input
          placeholder="Zakázaná ingredience"
          value={blockedInput}
          onChange={(e) => setBlockedInput(e.target.value)}
        />
        <button type="button" className="btn btnSecondary" onClick={handleAddBlocked}>
          Přidat
        </button>
      </div>
    </div>
  );
}

function PersonsSection() {
  const persons = useDataStore((s) => s.files.settings.data.persons);
  const setPersonName = useDataStore((s) => s.setPersonName);
  const setBlockedList = useDataStore((s) => s.setBlockedList);

  return (
    <section className={styles.section}>
      <h2>Osoby</h2>
      {([0, 1] as const).map((idx) => (
        <PersonCard
          key={idx}
          idx={idx}
          person={persons[idx]}
          setPersonName={setPersonName}
          setBlockedList={setBlockedList}
        />
      ))}
    </section>
  );
}

function formatRule(rule: DietRule): string {
  const parts: string[] = [];
  if (rule.min !== undefined) parts.push(`min ${rule.min}×`);
  if (rule.max !== undefined) parts.push(`max ${rule.max}×`);
  return parts.join(', ');
}

function DietRulesSection() {
  const dietRules = useDataStore((s) => s.files.settings.data.dietRules);
  const upsertDietRule = useDataStore((s) => s.upsertDietRule);
  const removeDietRule = useDataStore((s) => s.removeDietRule);

  const [category, setCategory] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const result = validateDietRule(category, min, max);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    void upsertDietRule(category.trim(), result.min, result.max);
    setCategory('');
    setMin('');
    setMax('');
  }

  return (
    <section className={styles.section}>
      <h2>Týdenní pravidla</h2>
      <ul className={styles.list}>
        {dietRules.map((rule) => (
          <li key={rule.category} className={styles.listItem}>
            <span>
              {rule.category}: {formatRule(rule)}
            </span>
            <button type="button" onClick={() => void removeDietRule(rule.category)}>
              Odebrat
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.form}>
        <input placeholder="Kategorie" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} />
        <input placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} />
        <button type="button" className="btn btnSecondary" onClick={handleAdd}>
          Přidat pravidlo
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function RotationSection() {
  const rotationWeeks = useDataStore((s) => s.files.settings.data.rotationWeeks);
  const setRotationWeeks = useDataStore((s) => s.setRotationWeeks);
  const [value, setValue] = useState(String(rotationWeeks));
  const [lastSyncedWeeks, setLastSyncedWeeks] = useState(rotationWeeks);
  const [error, setError] = useState<string | null>(null);

  if (rotationWeeks !== lastSyncedWeeks) {
    setLastSyncedWeeks(rotationWeeks);
    setValue(String(rotationWeeks));
  }

  function handleBlur() {
    const result = parseRotationWeeks(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.weeks !== rotationWeeks) void setRotationWeeks(result.weeks);
  }

  return (
    <section className={styles.section}>
      <h2>Rotace</h2>
      <label className={styles.field}>
        Nenavrhovat jídlo vařené v posledních N týdnech
        <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} onBlur={handleBlur} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function SettingsPage() {
  const status = useDataStore((s) => s.status);

  return (
    <div className={styles.page}>
      <h1>Nastavení</h1>
      <RepoSection />
      {status === 'ready' && (
        <>
          <PersonsSection />
          <DietRulesSection />
          <RotationSection />
        </>
      )}
    </div>
  );
}

export default SettingsPage;
