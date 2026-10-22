package tree_sitter_asl_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_asl "github.com/tabulatejarl8/tree-sitter-asl/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_asl.Language())
	if language == nil {
		t.Errorf("Error loading ASL grammar")
	}
}
