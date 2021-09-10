import GraphiQL from 'graphiql';
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { useApolloClient } from '@apollo/react-hooks';
import { GRAPHQL_PATH, GRAPHQL_SSL } from './provider';
import 'graphiql/graphiql.css';
import { useMemo, useState } from 'react';
import { generateHeaders } from '@deepcase/hasura/client';
import { TokenContext, useToken } from '@deepcase/react-hasura/token-context';

export function Graphiql({
  defaultQuery,
  onVisualize,
}: {
  defaultQuery: string;
  onVisualize: (query: string, variables: any) => any;
}) {
  const token: string = useToken() || '';
  const fetcher = useMemo(() => {
    return createGraphiQLFetcher({
      url: `http${GRAPHQL_SSL ? 's' : ''}://${GRAPHQL_PATH}`,
    });
  }, []);
  const [query, setQuery] = useState('');
  const [variables, setVariables] = useState({});
  return <>
    {!!fetcher && <>
      <GraphiQL
        query={defaultQuery}
        fetcher={fetcher}
        defaultVariableEditorOpen={false}
        editorTheme={'dracula'}
        headers={JSON.stringify(generateHeaders({
          token: token,
          client: 'deeplinks-graphiql',
        }))}
        toolbar={{
          additionalContent: <>
            <GraphiQL.Button title="Deep.Visualize" label="Deep.Vizualize" onClick={() => onVisualize(query, variables)}></GraphiQL.Button>
          </>
        }}
        onEditQuery={(query) => setQuery(query)}
        onEditVariables={(variables) => {
          try {
            setVariables(JSON.parse(variables));
          } catch(error) {}
        }}
      />
    </>}
  </>;
}
