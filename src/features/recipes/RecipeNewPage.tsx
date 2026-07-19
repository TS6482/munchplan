import { navigate } from '../../router/router';
import RecipeForm from './RecipeForm';
import styles from './RecipeListPage.module.css';

/** Full-page "new recipe" form, reached via the floating more-options menu. */
function RecipeNewPage() {
  return (
    <div className={styles.page}>
      <h1>Nový recept</h1>
      <RecipeForm onCancel={() => navigate({ name: 'recipes' })} />
    </div>
  );
}

export default RecipeNewPage;
