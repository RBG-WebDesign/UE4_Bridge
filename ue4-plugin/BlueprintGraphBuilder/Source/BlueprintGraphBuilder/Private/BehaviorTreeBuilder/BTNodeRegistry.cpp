#include "BTNodeRegistry.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "BehaviorTree/Composites/BTComposite_Selector.h"
#include "BehaviorTree/Composites/BTComposite_Sequence.h"
#include "BehaviorTree/Tasks/BTTask_MoveTo.h"
#include "BehaviorTree/Tasks/BTTask_Wait.h"
#include "BehaviorTree/Decorators/BTDecorator_Blackboard.h"
#include "BehaviorTree/BlackboardData.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Object.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Vector.h"

FBTNodeRegistry::FBTNodeRegistry()
{
	RegisterTypes();
}

void FBTNodeRegistry::RegisterTypes()
{
	// Composites
	CompositeTypes.Add(TEXT("Selector"), UBTComposite_Selector::StaticClass());
	CompositeTypes.Add(TEXT("Sequence"), UBTComposite_Sequence::StaticClass());

	// Tasks
	TaskTypes.Add(TEXT("MoveTo"), UBTTask_MoveTo::StaticClass());
	TaskTypes.Add(TEXT("Wait"), UBTTask_Wait::StaticClass());

	// Decorators
	DecoratorTypes.Add(TEXT("Blackboard"), UBTDecorator_Blackboard::StaticClass());

	// Default params
	{
		TMap<FString, FString> MoveToDefaults;
		MoveToDefaults.Add(TEXT("acceptable_radius"), TEXT("50.0"));
		DefaultParams.Add(TEXT("MoveTo"), MoveToDefaults);
	}
	{
		TMap<FString, FString> WaitDefaults;
		WaitDefaults.Add(TEXT("wait_time"), TEXT("5.0"));
		WaitDefaults.Add(TEXT("random_deviation"), TEXT("0.0"));
		DefaultParams.Add(TEXT("Wait"), WaitDefaults);
	}

	// BB key type requirements
	{
		TMap<FString, TSet<FString>> MoveToReqs;
		TSet<FString> MoveToKeyTypes;
		MoveToKeyTypes.Add(TEXT("Object"));
		MoveToKeyTypes.Add(TEXT("Vector"));
		MoveToReqs.Add(TEXT("blackboard_key"), MoveToKeyTypes);
		BBKeyTypeRequirements.Add(TEXT("MoveTo"), MoveToReqs);
	}
}

bool FBTNodeRegistry::IsComposite(const FString& Type) const
{
	return CompositeTypes.Contains(Type);
}

bool FBTNodeRegistry::IsTask(const FString& Type) const
{
	return TaskTypes.Contains(Type);
}

bool FBTNodeRegistry::IsDecorator(const FString& Type) const
{
	return DecoratorTypes.Contains(Type);
}

bool FBTNodeRegistry::IsKnownType(const FString& Type) const
{
	return IsComposite(Type) || IsTask(Type) || IsDecorator(Type);
}

TSubclassOf<UBTCompositeNode> FBTNodeRegistry::GetCompositeClass(const FString& Type) const
{
	const auto* Found = CompositeTypes.Find(Type);
	return Found ? *Found : nullptr;
}

TSubclassOf<UBTTaskNode> FBTNodeRegistry::GetTaskClass(const FString& Type) const
{
	const auto* Found = TaskTypes.Find(Type);
	return Found ? *Found : nullptr;
}

TSubclassOf<UBTDecorator> FBTNodeRegistry::GetDecoratorClass(const FString& Type) const
{
	const auto* Found = DecoratorTypes.Find(Type);
	return Found ? *Found : nullptr;
}

const TMap<FString, FString>* FBTNodeRegistry::GetDefaultParams(const FString& Type) const
{
	return DefaultParams.Find(Type);
}

const TMap<FString, TSet<FString>>* FBTNodeRegistry::GetBBKeyRequirements(const FString& Type) const
{
	return BBKeyTypeRequirements.Find(Type);
}

void FBTNodeRegistry::ApplyParams(
	UBTNode* Node,
	const FString& Type,
	const TMap<FString, FString>& Params,
	UBlackboardData* Blackboard) const
{
	if (!Node) return;

	// Merge defaults with explicit params (explicit wins)
	TMap<FString, FString> Merged;
	const TMap<FString, FString>* Defaults = GetDefaultParams(Type);
	if (Defaults)
	{
		Merged = *Defaults;
	}
	for (const auto& Pair : Params)
	{
		Merged.Add(Pair.Key, Pair.Value);
	}

	if (Type == TEXT("MoveTo"))
	{
		UBTTask_MoveTo* MoveToNode = Cast<UBTTask_MoveTo>(Node);
		if (!MoveToNode) return;

		if (const FString* KeyName = Merged.Find(TEXT("blackboard_key")))
		{
			MoveToNode->BlackboardKey.SelectedKeyName = FName(**KeyName);
			if (Blackboard)
			{
				MoveToNode->BlackboardKey.ResolveSelectedKey(*Blackboard);
			}
		}
		if (const FString* Radius = Merged.Find(TEXT("acceptable_radius")))
		{
			MoveToNode->AcceptableRadius = FCString::Atof(**Radius);
		}
	}
	else if (Type == TEXT("Wait"))
	{
		UBTTask_Wait* WaitNode = Cast<UBTTask_Wait>(Node);
		if (!WaitNode) return;

		if (const FString* Time = Merged.Find(TEXT("wait_time")))
		{
			WaitNode->WaitTime = FCString::Atof(**Time);
		}
		if (const FString* Dev = Merged.Find(TEXT("random_deviation")))
		{
			WaitNode->RandomDeviation = FCString::Atof(**Dev);
		}
	}
	else if (Type == TEXT("Blackboard"))
	{
		UBTDecorator_Blackboard* BBDec = Cast<UBTDecorator_Blackboard>(Node);
		if (!BBDec) return;

		if (const FString* KeyName = Merged.Find(TEXT("blackboard_key")))
		{
			BBDec->BlackboardKey.SelectedKeyName = FName(**KeyName);
			if (Blackboard)
			{
				BBDec->BlackboardKey.ResolveSelectedKey(*Blackboard);
			}
		}
		if (const FString* Condition = Merged.Find(TEXT("condition")))
		{
			if (*Condition == TEXT("IsSet"))
			{
				BBDec->BasicOperation = EBasicKeyOperation::Set;
			}
			else if (*Condition == TEXT("IsNotSet"))
			{
				BBDec->BasicOperation = EBasicKeyOperation::NotSet;
			}
		}
	}
}
