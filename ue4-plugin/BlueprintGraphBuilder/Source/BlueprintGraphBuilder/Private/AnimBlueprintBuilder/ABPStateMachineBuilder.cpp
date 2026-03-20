#include "ABPStateMachineBuilder.h"
#include "ABPBuildSpec.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/AnimSequence.h"
#include "AnimationStateMachineGraph.h"
#include "AnimStateNode.h"
#include "AnimStateEntryNode.h"
#include "AnimationStateGraph.h"
#include "AnimGraphNode_SequencePlayer.h"
#include "AnimGraphNode_StateResult.h"
#include "EdGraphSchema_K2.h"

FString FAnimBPStateMachineBuilder::BuildStates(const FAnimBPBuildSpec& Spec, FAnimBPBuildContext& Ctx)
{
	if (!Ctx.StateMachineGraph)
	{
		return TEXT("[ABPStateMachineBuilder] StateMachineGraph is null -- AnimGraph must be built first");
	}

	// Create all state nodes
	for (int32 Index = 0; Index < Spec.States.Num(); ++Index)
	{
		const FAnimBPStateSpec& State = Spec.States[Index];

		// 1. Create state node
		UAnimStateNode* StateNode = NewObject<UAnimStateNode>(Ctx.StateMachineGraph);
		StateNode->CreateNewGuid();
		StateNode->PostPlacedNewNode();
		StateNode->AllocateDefaultPins();
		Ctx.StateMachineGraph->AddNode(StateNode, false, false);

		// 2. Set state name via bound graph rename
		StateNode->GetBoundGraph()->Rename(*State.Name, nullptr, REN_None);

		// 3. Get the state's inner graph and result node
		UAnimationStateGraph* StateGraph = Cast<UAnimationStateGraph>(StateNode->GetBoundGraph());
		if (!StateGraph)
		{
			return FString::Printf(TEXT("[ABPStateMachineBuilder] failed to get state graph for state: %s"), *State.Name);
		}

		UAnimGraphNode_StateResult* ResultNode = StateGraph->MyResultNode;
		if (!ResultNode)
		{
			return FString::Printf(TEXT("[ABPStateMachineBuilder] no result node in state graph for state: %s"), *State.Name);
		}

		// 4. Create SequencePlayer node
		UAnimGraphNode_SequencePlayer* SeqPlayer = NewObject<UAnimGraphNode_SequencePlayer>(StateGraph);
		SeqPlayer->CreateNewGuid();
		SeqPlayer->PostPlacedNewNode();
		SeqPlayer->AllocateDefaultPins();
		StateGraph->AddNode(SeqPlayer, false, false);

		// 5. Load animation and set properties
		UAnimSequence* AnimSeq = LoadObject<UAnimSequence>(nullptr, *State.Animation);
		if (!AnimSeq)
		{
			return FString::Printf(TEXT("[ABPStateMachineBuilder] animation not found: %s"), *State.Animation);
		}
		SeqPlayer->Node.Sequence = AnimSeq;
		SeqPlayer->Node.bLoopAnimation = State.bLooping;

		// 6. Wire SequencePlayer output pose to StateResult input pose
		UEdGraphPin* SeqOutput = nullptr;
		UEdGraphPin* ResultInput = nullptr;

		for (UEdGraphPin* Pin : SeqPlayer->Pins)
		{
			if (Pin->Direction == EGPD_Output && Pin->PinType.PinCategory == UEdGraphSchema_K2::PC_Struct)
			{
				SeqOutput = Pin;
				break;
			}
		}

		for (UEdGraphPin* Pin : ResultNode->Pins)
		{
			if (Pin->Direction == EGPD_Input)
			{
				ResultInput = Pin;
				break;
			}
		}

		if (SeqOutput && ResultInput)
		{
			SeqOutput->MakeLinkTo(ResultInput);
		}

		// 7. Store in context and position nodes
		Ctx.StateNodeMap.Add(State.Id, StateNode);
		StateNode->NodePosX = (Index % 3) * 400;
		StateNode->NodePosY = (Index / 3) * 300;
		SeqPlayer->NodePosX = -200;
		SeqPlayer->NodePosY = 0;
	}

	// 8. Wire entry state
	for (const FAnimBPStateSpec& State : Spec.States)
	{
		if (State.bIsEntry)
		{
			UAnimStateNode* EntryState = Ctx.StateNodeMap.FindRef(State.Id);
			if (EntryState && Ctx.StateMachineGraph->EntryNode)
			{
				UEdGraphPin* EntryOutput = nullptr;
				for (UEdGraphPin* Pin : Ctx.StateMachineGraph->EntryNode->Pins)
				{
					if (Pin->Direction == EGPD_Output)
					{
						EntryOutput = Pin;
						break;
					}
				}

				UEdGraphPin* StateInput = nullptr;
				for (UEdGraphPin* Pin : EntryState->Pins)
				{
					if (Pin->Direction == EGPD_Input)
					{
						StateInput = Pin;
						break;
					}
				}

				if (EntryOutput && StateInput)
				{
					EntryOutput->MakeLinkTo(StateInput);
				}
			}
			break;
		}
	}

	return FString();
}

FString FAnimBPStateMachineBuilder::BuildTransitions(const FAnimBPBuildSpec& Spec, FAnimBPBuildContext& Ctx)
{
	return FString(); // Implemented in Task 8
}
