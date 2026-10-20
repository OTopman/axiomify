import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VariableInput } from '../src/components/VariableInput';

describe('VariableInput component', () => {
  const sampleVariables = [
    { key: 'baseUrl', value: 'http://localhost:3000', environmentName: 'Local' },
    { key: 'token', value: 'jwt_secret_token_1234', environmentName: 'Local' },
  ];

  it('renders standard text input with placeholder and value', () => {
    const markup = renderToStaticMarkup(
      <VariableInput
        value="https://api.com/users"
        placeholder="Enter request URL"
        variables={sampleVariables}
        onChange={() => { }}
      />,
    );
    expect(markup).toContain('value="https://api.com/users"');
    expect(markup).toContain('placeholder="Enter request URL"');
  });

  it('renders multiline textarea when multiline is true', () => {
    const markup = renderToStaticMarkup(
      <VariableInput
        multiline
        rows={4}
        value="Sample raw body text"
        variables={sampleVariables}
        onChange={() => { }}
      />,
    );
    expect(markup).toContain('<textarea');
    expect(markup).toContain('rows="4"');
    expect(markup).toContain('Sample raw body text</textarea>');
  });
});
