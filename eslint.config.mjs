import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // 🏗 Архітектурні правила (Складність)
      
      // Максимальна кількість гілок в одній функції (if/else/switch/цикли)
      'complexity': ['warn', 15], 
      
      // Максимальна глибина вкладеності (наприклад, if всередині if всередині for)
      'max-depth': ['warn', 3],
      
      // Максимальна довжина функції
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      
      // Максимальна довжина одного файлу (великі файли = поганий розподіл відповідальності)
      'max-lines': ['warn', 300],
      
      // Максимальна кількість вкладених колбеків
      'max-nested-callbacks': ['warn', 3],

      // Послаблюємо стандартні правила, щоб сфокусуватися на архітектурі
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off'
    }
  }
);
