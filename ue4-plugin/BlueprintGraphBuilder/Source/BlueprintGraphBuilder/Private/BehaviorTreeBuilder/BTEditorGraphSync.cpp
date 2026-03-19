#include "BTEditorGraphSync.h"

#if WITH_EDITOR

#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "BehaviorTreeGraphNode_Composite.h"
#include "BehaviorTreeGraphNode_Task.h"
#include "BehaviorTreeGraphNode_Decorator.h"
#include "BehaviorTreeGraph.h"
#include "EdGraphSchema_BehaviorTree.h"
#include "EdGraph/EdGraph.h"
#include "Kismet2/BlueprintEditorUtils.h"

static UBTGraphNode* CreateGraphNodeForRuntime(UBTNode* RuntimeNode, UBehaviorTreeGraph* BTGraph)
{
	UBTGraphNode* GraphNode = nullptr;

	if (Cast<UBTCompositeNode>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Composite>(BTGraph);
	}
	else if (Cast<UBTTaskNode>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Task>(BTGraph);
	}
	else if (Cast<UBTDecorator>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Decorator>(BTGraph);
	}

	if (GraphNode)
	{
		GraphNode->NodeInstance = RuntimeNode;
		BTGraph->AddNode(GraphNode, /*bFromUI=*/false, /*bSelectNewNode=*/false);
		GraphNode->AllocateDefaultPins();
	}

	return GraphNode;
}

static void SyncComposite(
	UBTCompositeNode* Composite,
	UBTGraphNode* ParentGraphNode,
	UBehaviorTreeGraph* BTGraph)
{
	if (!Composite || !ParentGraphNode) return;

	for (const FBTCompositeChild& Child : Composite->Children)
	{
		UBTNode* ChildNode = Child.ChildComposite
			? static_cast<UBTNode*>(Child.ChildComposite)
			: static_cast<UBTNode*>(Child.ChildTask);

		if (!ChildNode) continue;

		UBTGraphNode* ChildGraphNode = CreateGraphNodeForRuntime(ChildNode, BTGraph);
		if (!ChildGraphNode) continue;

		// Connect parent output pin to child input pin
		if (ParentGraphNode->Pins.Num() > 0 && ChildGraphNode->Pins.Num() > 0)
		{
			UEdGraphPin* OutputPin = nullptr;
			for (UEdGraphPin* Pin : ParentGraphNode->Pins)
			{
				if (Pin->Direction == EGPD_Output)
				{
					OutputPin = Pin;
					break;
				}
			}
			UEdGraphPin* InputPin = nullptr;
			for (UEdGraphPin* Pin : ChildGraphNode->Pins)
			{
				if (Pin->Direction == EGPD_Input)
				{
					InputPin = Pin;
					break;
				}
			}
			if (OutputPin && InputPin)
			{
				OutputPin->MakeLinkTo(InputPin);
			}
		}

		// Add decorators as sub-nodes
		for (UBTDecorator* Dec : Child.Decorators)
		{
			if (!Dec) continue;
			UBTGraphNode* DecGraphNode = CreateGraphNodeForRuntime(Dec, BTGraph);
			if (DecGraphNode)
			{
				ChildGraphNode->AddSubNode(DecGraphNode, BTGraph);
			}
		}

		// Recurse if child is composite
		if (Child.ChildComposite)
		{
			SyncComposite(Child.ChildComposite, ChildGraphNode, BTGraph);
		}
	}
}

void FBTEditorGraphSync::Sync(UBehaviorTree* BT)
{
	if (!BT || !BT->RootNode)
	{
		UE_LOG(LogTemp, Warning, TEXT("[BTEditorGraphSync] BT or RootNode is null, skipping sync"));
		return;
	}

	// Get or create editor graph
	UBehaviorTreeGraph* BTGraph = Cast<UBehaviorTreeGraph>(BT->BTGraph);
	if (!BTGraph)
	{
		BTGraph = CastChecked<UBehaviorTreeGraph>(
			FBlueprintEditorUtils::CreateNewGraph(
				BT, TEXT("BehaviorTreeGraph"),
				UBehaviorTreeGraph::StaticClass(),
				UEdGraphSchema_BehaviorTree::StaticClass()
			)
		);
		BT->BTGraph = BTGraph;
	}

	// Clear existing graph nodes safely
	BTGraph->Modify();
	for (int32 i = BTGraph->Nodes.Num() - 1; i >= 0; --i)
	{
		if (BTGraph->Nodes[i])
		{
			BTGraph->RemoveNode(BTGraph->Nodes[i]);
		}
	}

	// Create root graph node
	UBTGraphNode* RootGraphNode = CreateGraphNodeForRuntime(BT->RootNode, BTGraph);
	if (!RootGraphNode)
	{
		UE_LOG(LogTemp, Warning, TEXT("[BTEditorGraphSync] failed to create root graph node"));
		return;
	}

	// Recursively sync the tree
	SyncComposite(BT->RootNode, RootGraphNode, BTGraph);

	// Finalize
	BTGraph->UpdateAsset();
	BT->MarkPackageDirty();

	UE_LOG(LogTemp, Log, TEXT("[BTEditorGraphSync] synced editor graph for '%s'"), *BT->GetName());
}

#else  // !WITH_EDITOR

void FBTEditorGraphSync::Sync(UBehaviorTree* BT)
{
	// No-op outside editor
}

#endif  // WITH_EDITOR
